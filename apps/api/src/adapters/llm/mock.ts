import type { LLMAdapter, LLMResponse } from '@adaprio/shared-types';

/**
 * Test-only adapter (Ch 19.2). Returns a queue of pre-configured responses
 * in order, or a single fixed response for every call. Never touches the
 * network — used by unit tests for pipeline/write.ts and integration tests
 * that don't need real extraction quality, only correct pipeline wiring.
 */
export class MockLLMAdapter implements LLMAdapter {
  readonly name = 'mock-llm';

  private queue: Array<LLMResponse | Error>;
  private readonly calls: Array<{ systemPrompt: string; userMessage: string }> = [];

  constructor(responses: Array<LLMResponse | Error> = []) {
    this.queue = [...responses];
  }

  async extract(systemPrompt: string, userMessage: string): Promise<LLMResponse> {
    this.calls.push({ systemPrompt, userMessage });
    const next = this.queue.shift();
    if (next === undefined) {
      return { contains_memory: false, memories: [] };
    }
    if (next instanceof Error) throw next;
    return next;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  /** Test helper — inspect what the pipeline actually sent. */
  getCalls(): ReadonlyArray<{ systemPrompt: string; userMessage: string }> {
    return this.calls;
  }

  /** Test helper — queue additional responses mid-test. */
  enqueue(response: LLMResponse | Error): void {
    this.queue.push(response);
  }
}
