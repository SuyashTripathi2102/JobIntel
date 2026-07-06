/**
 * Provider-agnostic LLM contract. Features depend on THIS, never on a vendor
 * SDK — switching Gemini → OpenAI/Claude is a config change (AI_PROVIDER),
 * not a refactor.
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface FilePart {
  mimeType: string; // e.g. "application/pdf"
  data: Buffer;
}

export interface GenerateOptions {
  system?: string;
  /** Attach files (PDFs, images) for multimodal models. */
  files?: FilePart[];
  maxOutputTokens?: number;
  temperature?: number;
}

export interface LlmProvider {
  /** Free-form text generation. */
  generateText(prompt: string, opts?: GenerateOptions): Promise<string>;

  /** JSON-mode generation, parsed and typed by the caller. */
  generateJson<T>(prompt: string, opts?: GenerateOptions): Promise<T>;

  /** Batch embeddings — dimensionality fixed by EMBEDDING_DIMS (pgvector schema). */
  embed(texts: string[]): Promise<number[][]>;
}
