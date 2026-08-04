import type { LLMAdapter, LLMResponse } from '@adaprio/shared-types';
import { LLMAdapterError } from '@adaprio/shared-types';

/**
 * Fallback Memory Intelligence LLM (Ch 04.3: HF Qwen3-8B, activated on
 * Groq timeout/429/5xx).
 *
 * ⚠️ CONFIDENCE FLAG: Hugging Face's Inference API has had multiple
 * generations of endpoint conventions (the classic per-model
 * `api-inference.huggingface.co/models/{model}` endpoint with a
 * task-specific payload, and the newer OpenAI-compatible chat-completions
 * router at `router.huggingface.co/v1/chat/completions`). This adapter
 * targets the OpenAI-compatible router because it keeps this file
 * structurally identical to groq.ts, which lowers the chance of a
 * request-shape bug — but I do not have live access to confirm this is
 * currently the correct endpoint/shape for Qwen3-8B specifically. Verify
 * against current HF documentation before relying on this in production;
 * this is the one adapter in this directory built on the least-certain
 * ground.
 */

interface HFChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface HuggingFaceLLMAdapterConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
}

export class HuggingFaceLLMAdapter implements LLMAdapter {
  readonly name = 'huggingface';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly temperature: number;

  constructor(config: HuggingFaceLLMAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'Qwen/Qwen3-8B'; // Ch 04.3
    this.baseUrl = config.baseUrl ?? 'https://router.huggingface.co/v1';
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
        throw new LLMAdapterError('TIMEOUT', `Hugging Face request exceeded ${timeoutMs}ms`, true);
      }
      throw new LLMAdapterError('NETWORK', `Hugging Face request failed: ${(err as Error).message}`, true);
    }
    clearTimeout(timer);

    if (response.status === 429) {
      throw new LLMAdapterError('RATE_LIMIT', 'Hugging Face rate limit exceeded', true);
    }
    if (response.status >= 500) {
      throw new LLMAdapterError('SERVER_ERROR', `Hugging Face server error: HTTP ${response.status}`, true);
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new LLMAdapterError('SERVER_ERROR', `Hugging Face request rejected: HTTP ${response.status} ${bodyText}`, false);
    }

    let body: HFChatCompletionResponse;
    try {
      body = (await response.json()) as HFChatCompletionResponse;
    } catch {
      throw new LLMAdapterError('SCHEMA_INVALID', 'Hugging Face response body was not valid JSON', true);
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new LLMAdapterError('SCHEMA_INVALID', 'Hugging Face response had no message content', true);
    }

    try {
      return JSON.parse(content) as LLMResponse;
    } catch {
      throw new LLMAdapterError('SCHEMA_INVALID', 'Hugging Face response content was not valid JSON', true);
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
