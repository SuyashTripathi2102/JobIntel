import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilePart, GenerateOptions, LlmProvider } from './llm.provider';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
// API allows 100/call, but the free tier's tokens-per-minute cap makes big
// batches 429 — smaller batches with pacing finish faster than retry loops.
// Free-tier embedding quota counts each batch ITEM as a request (~100/min):
// 20 items per call, one call every ~15s ≈ 80 items/min — safely under the cap.
const EMBED_BATCH_SIZE = 20;
const EMBED_BATCH_DELAY_MS = 15_000;
const MAX_RETRIES = 4;

@Injectable()
export class GeminiProvider implements LlmProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly key: string;
  private readonly textModel: string;
  private readonly embeddingModel: string;
  private readonly embeddingDims: number;

  constructor(config: ConfigService) {
    this.key = config.getOrThrow<string>('GEMINI_API_KEY');
    this.textModel = config.get<string>('GEMINI_TEXT_MODEL', 'gemini-3.5-flash');
    this.embeddingModel = config.get<string>('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-2');
    this.embeddingDims = Number(config.get('EMBEDDING_DIMS', 1536));
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
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const body = {
        requests: batch.map((text) => ({
          model: `models/${this.embeddingModel}`,
          content: { parts: [{ text }] },
          outputDimensionality: this.embeddingDims,
        })),
      };
      const res = await this.request<{ embeddings: { values: number[] }[] }>(
        `${BASE}/models/${this.embeddingModel}:batchEmbedContents`,
        body,
      );
      out.push(...res.embeddings.map((e) => e.values));

      if (i + EMBED_BATCH_SIZE < texts.length) {
        if ((i / EMBED_BATCH_SIZE) % 10 === 9) {
          this.logger.log(`Embedding progress: ${out.length}/${texts.length}`);
        }
        await new Promise((r) => setTimeout(r, EMBED_BATCH_DELAY_MS));
      }
    }
    return out;
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

    const res = await this.request<{
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    }>(`${BASE}/models/${this.textModel}:generateContent`, body);

    const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new Error('Gemini returned an empty response');
    return text;
  }

  /** POST with retry on 429/5xx — free-tier rate limits are expected, not fatal. */
  private async request<T>(url: string, body: unknown): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${url}?key=${this.key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) return (await res.json()) as T;

      const retryable = res.status === 429 || res.status >= 500;
      const text = await res.text().catch(() => '');
      if (!retryable || attempt >= MAX_RETRIES) {
        throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
      }
      const delayMs = Math.min(60_000, 5_000 * 2 ** (attempt - 1));
      this.logger.warn(`Gemini ${res.status}, retry ${attempt}/${MAX_RETRIES} in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
