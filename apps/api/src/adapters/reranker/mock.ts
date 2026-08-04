import type { RerankerAdapter } from '@adaprio/shared-types';

/**
 * Test-only adapter (Ch 19.2). Scores documents by a trivial token-overlap
 * heuristic against the query — deterministic and fast, not a quality
 * signal. Never touches the network.
 */
export class MockRerankerAdapter implements RerankerAdapter {
  readonly name = 'mock-reranker';

  async rerank(query: string, documents: string[]): Promise<number[]> {
    const queryTokens = new Set(query.toLowerCase().split(/\s+/).filter(Boolean));
    return documents.map((doc) => {
      const docTokens = doc.toLowerCase().split(/\s+/).filter(Boolean);
      if (docTokens.length === 0) return 0;
      const overlap = docTokens.filter((t) => queryTokens.has(t)).length;
      return Math.min(1, overlap / docTokens.length);
    });
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
