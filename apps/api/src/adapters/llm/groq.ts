import type { LLMAdapter, LLMResponse } from '@adaprio/shared-types';
import { LLMAdapterError } from '@adaprio/shared-types';

/**
 * Primary Memory Intelligence LLM (Ch 04.3, 04.6 latency budget, 30.1 prompt
 * contract). Groq's chat completions API is OpenAI-compatible — this is the
 * one adapter in this directory built on a well-established, stable wire
 * format, so it carries the least uncertainty of the four provider adapters.
 *
 * ⚠️ One divergence from the handbook worth flagging: Ch 04.3 describes the
 * request as using "JSON schema output mode" with
 * `response_format: { type: 'json_object', schema: LLMResponseSchema }`.
 * Groq's documented API (as an OpenAI-compatible surface) supports
 * `response_format: { type: 'json_object' }` — guaranteed-valid JSON, no
 * embedded schema enforcement — not a `type: 'json_schema'` mode with a
 * schema payload the way OpenAI's newer structured-outputs feature works.
 * This adapter uses `{ type: 'json_object' }` only; actual schema
 * enforcement is the zod validation in `lib/llm-schema.ts` (Ch 04.4), which
 * was always a separate pipeline stage regardless. If Groq ships true
 * schema-constrained output for this model, this is the one file to update.
 */

interface GroqChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface GroqLLMAdapterConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Sampling temperature. Low by default — extraction should be near-deterministic, not creative. */
  temperature?: number;
}

export class GroqLLMAdapter implements LLMAdapter {
  readonly name = 'groq';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly temperature: number;

  constructor(config: GroqLLMAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'qwen/qwen3-32b'; // Ch 04.3 — Qwen 3.6 27B
    this.baseUrl = config.baseUrl ?? 'https://api.groq.com/openai/v1';
    this.temperature = config.temperature ?? 0.1;
  }

  async extract(systemPrompt: string, userMessage: string, options?: { timeoutMs?: number }): Promise<LLMResponse> {
    const timeoutMs = options?.timeoutMs ?? 5000; // Ch 25-C LLM_TIMEOUT_MS default
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          response_format: { type: 'json_object' },
          temperature: this.temperature,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LLMAdapterError('TIMEOUT', `Groq request exceeded ${timeoutMs}ms`, true);
      }
      throw new LLMAdapterError('NETWORK', `Groq request failed: ${(err as Error).message}`, true);
    }
    clearTimeout(timer);

    if (response.status === 429) {
      throw new LLMAdapterError('RATE_LIMIT', 'Groq rate limit exceeded', true);
    }
    if (response.status >= 500) {
      throw new LLMAdapterError('SERVER_ERROR', `Groq server error: HTTP ${response.status}`, true);
    }
    if (!response.ok) {
      // 4xx other than 429 means our request was malformed — retrying the
      // fallback provider with the same inputs would fail the same way.
      const bodyText = await response.text().catch(() => '');
      throw new LLMAdapterError('SERVER_ERROR', `Groq request rejected: HTTP ${response.status} ${bodyText}`, false);
    }

    let body: GroqChatCompletionResponse;
    try {
      body = (await response.json()) as GroqChatCompletionResponse;
    } catch {
      throw new LLMAdapterError('SCHEMA_INVALID', 'Groq response body was not valid JSON', true);
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new LLMAdapterError('SCHEMA_INVALID', 'Groq response had no message content', true);
    }

    try {
      // NOTE: this only parses the content string into an object — it does
      // NOT validate it against LLMResponseSchema. That happens one layer
      // up, in lib/llm-schema.ts (Ch 04.4). Keeping schema validation out of
      // the adapter keeps this file provider-specific and the validation
      // logic provider-agnostic (the same validator runs regardless of
      // which LLMAdapter produced the raw JSON).
      return JSON.parse(content) as LLMResponse;
    } catch {
      throw new LLMAdapterError('SCHEMA_INVALID', 'Groq response content was not valid JSON', true);
    }
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
