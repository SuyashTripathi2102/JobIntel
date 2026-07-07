import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiCallKind } from '@prisma/client';
import { GoogleAuth } from 'google-auth-library';
import { AiUsageService } from './ai-usage.service';
import { EmbeddingProvider, FilePart, GenerateOptions, LlmProvider } from './llm.provider';
import { QuotaExhaustedError } from './gemini.provider';

// Vertex bills to Google Cloud (trial credits apply), unlike the Developer
// API (generativelanguage.googleapis.com) whose paid tier is prepaid-only.
// Same models, same token prices, different endpoint + auth.
const MAX_RETRIES = 4;

@Injectable()
export class VertexGeminiProvider implements LlmProvider, EmbeddingProvider {
  private readonly logger = new Logger(VertexGeminiProvider.name);
  private readonly auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  private readonly project: string;
  private readonly location: string;
  private readonly textModel: string;
  readonly embeddingModelId: string;
  private readonly embeddingDims: number;
  private readonly embedBatchSize: number;
  private readonly quotaCooldownMs: number;

  private circuitOpenUntil = 0;

  constructor(
    config: ConfigService,
    private readonly usage: AiUsageService,
  ) {
    // getOrThrow would break boot when vertex isn't selected — the module
    // factory instantiates this class eagerly, so validate lazily instead.
    // `||` fall-throughs (not config defaults): compose ${VAR:-} yields empty
    // strings, which ConfigService returns instead of the default.
    this.project = config.get<string>('GOOGLE_CLOUD_PROJECT') || '';
    this.location = config.get<string>('GOOGLE_CLOUD_LOCATION') || 'global';
    this.textModel =
      config.get<string>('VERTEX_TEXT_MODEL') ||
      config.get<string>('GEMINI_TEXT_MODEL') ||
      'gemini-3.5-flash';
    // NB: Vertex serves gemini-embedding-001, not the Developer API's -2 name
    this.embeddingModelId =
      config.get<string>('VERTEX_EMBEDDING_MODEL') || 'gemini-embedding-001';
    this.embeddingDims = Number(config.get('EMBEDDING_DIMS')) || 1536;
    // gemini-embedding models on Vertex historically cap instances-per-call
    // low; 1 is always safe, raise via env once the quota page confirms more.
    this.embedBatchSize = Number(config.get('VERTEX_EMBED_BATCH_SIZE')) || 1;
    this.quotaCooldownMs = Number(config.get('AI_QUOTA_COOLDOWN_MS', 10 * 60_000));
  }

  async generateText(prompt: string, opts?: GenerateOptions): Promise<string> {
    return this.generate(prompt, opts, false);
  }

  async generateJson<T>(prompt: string, opts?: GenerateOptions): Promise<T> {
    const text = await this.generate(prompt, opts, true);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Model returned invalid JSON: ${text.slice(0, 200)}`);
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const startedAt = Date.now();
    const out: number[][] = [];
    try {
      for (let i = 0; i < texts.length; i += this.embedBatchSize) {
        const batch = texts.slice(i, i + this.embedBatchSize);
        const body = {
          instances: batch.map((text) => ({
            content: text,
            task_type: 'SEMANTIC_SIMILARITY',
          })),
          parameters: { outputDimensionality: this.embeddingDims },
        };
        const res = await this.request<{
          predictions: { embeddings: { values: number[] } }[];
        }>(this.modelUrl(this.embeddingModelId, 'predict'), body);
        out.push(...res.predictions.map((p) => p.embeddings.values));
      }
      this.usage.record({
        kind: AiCallKind.EMBED,
        provider: 'vertex',
        model: this.embeddingModelId,
        items: texts.length,
        inputTokens: Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4),
        ok: true,
        latencyMs: Date.now() - startedAt,
      });
      return out;
    } catch (err) {
      this.usage.record({
        kind: AiCallKind.EMBED,
        provider: 'vertex',
        model: this.embeddingModelId,
        items: texts.length,
        ok: false,
        errorCode: errorCode(err),
        latencyMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  private async generate(
    prompt: string,
    opts: GenerateOptions | undefined,
    json: boolean,
  ): Promise<string> {
    const parts: unknown[] = [
      ...(opts?.files ?? []).map((f: FilePart) => ({
        inline_data: { mime_type: f.mimeType, data: f.data.toString('base64') },
      })),
      { text: prompt },
    ];

    const body = {
      contents: [{ role: 'user', parts }],
      ...(opts?.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      generationConfig: {
        ...(json ? { responseMimeType: 'application/json' } : {}),
        temperature: opts?.temperature ?? 0.2,
        maxOutputTokens: opts?.maxOutputTokens ?? 8192,
      },
    };

    const startedAt = Date.now();
    try {
      const res = await this.request<{
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      }>(this.modelUrl(this.textModel, 'generateContent'), body);

      const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (!text) throw new Error('Vertex returned an empty response');

      this.usage.record({
        kind: AiCallKind.GENERATE,
        provider: 'vertex',
        model: this.textModel,
        items: 1,
        inputTokens: res.usageMetadata?.promptTokenCount,
        outputTokens: res.usageMetadata?.candidatesTokenCount,
        ok: true,
        latencyMs: Date.now() - startedAt,
      });
      return text;
    } catch (err) {
      this.usage.record({
        kind: AiCallKind.GENERATE,
        provider: 'vertex',
        model: this.textModel,
        items: 1,
        ok: false,
        errorCode: errorCode(err),
        latencyMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  private modelUrl(model: string, verb: 'generateContent' | 'predict'): string {
    if (!this.project) {
      throw new Error(
        'GOOGLE_CLOUD_PROJECT is not set — required when an AI provider is "vertex"',
      );
    }
    const host =
      this.location === 'global'
        ? 'aiplatform.googleapis.com'
        : `${this.location}-aiplatform.googleapis.com`;
    return `https://${host}/v1/projects/${this.project}/locations/${this.location}/publishers/google/models/${model}:${verb}`;
  }

  /** POST with SA-token auth + retry on 429/5xx + quota circuit (see GeminiProvider). */
  private async request<T>(url: string, body: unknown): Promise<T> {
    const wait = this.circuitOpenUntil - Date.now();
    if (wait > 0) throw new QuotaExhaustedError(wait);

    const token = await this.auth.getAccessToken();

    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        this.circuitOpenUntil = 0;
        return (await res.json()) as T;
      }

      const retryable = res.status === 429 || res.status >= 500;
      const text = await res.text().catch(() => '');
      if (!retryable || attempt >= MAX_RETRIES) {
        if (res.status === 429) {
          this.circuitOpenUntil = Date.now() + this.quotaCooldownMs;
          this.logger.error(
            `Vertex quota exhausted — circuit open for ${this.quotaCooldownMs / 60_000}min`,
          );
        }
        throw new Error(`Vertex ${res.status}: ${text.slice(0, 300)}`);
      }
      const delayMs = Math.min(60_000, 5_000 * 2 ** (attempt - 1));
      this.logger.warn(`Vertex ${res.status}, retry ${attempt}/${MAX_RETRIES} in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

function errorCode(err: unknown): string {
  if (err instanceof QuotaExhaustedError) return 'quota_circuit_open';
  const msg = err instanceof Error ? err.message : String(err);
  const status = /Vertex (\d{3})/.exec(msg)?.[1];
  return status ? `http_${status}` : 'error';
}
