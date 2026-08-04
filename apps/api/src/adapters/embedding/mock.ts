import type { EmbeddingAdapter } from '@adaprio/shared-types';

/**
 * Test-only adapter (Ch 19.2). Produces deterministic, cheap-to-compute
 * fake vectors (a hash of the input text spread across 1024 dimensions) —
 * good enough for pipeline-wiring tests, meaningless for retrieval-quality
 * tests. Never touches the network.
 */
export class MockEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = 'mock-embedding';
  readonly dimension = 1024;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.fakeVector(text));
  }

  async ping(): Promise<boolean> {
    return true;
  }

  private fakeVector(text: string): number[] {
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = (seed * 31 + text.charCodeAt(i)) % 1_000_003;
    }
    const vector = new Array<number>(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      vector[i] = (seed / 2147483648) * 2 - 1; // spread into [-1, 1]
    }
    return vector;
  }
}
