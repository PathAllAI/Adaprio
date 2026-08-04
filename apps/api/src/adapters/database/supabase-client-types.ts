/**
 * Minimal structural type for the pieces of `@supabase/supabase-js`'s
 * `SupabaseClient` this adapter uses. The real package provides much
 * richer generics (typed tables, typed RPC returns) — this local stub
 * exists only so `supabase.ts` can be type-checked without that package
 * installed. Once `@adaprio/api` actually depends on `@supabase/supabase-js`,
 * prefer importing `SupabaseClient` from it and delete this file.
 *
 * The shape here (a "thenable" query builder resolving to `{ data, error }`)
 * reflects supabase-js v2's well-established, stable public API — this is
 * the highest-confidence of the local type stubs in this directory, unlike
 * the Cloudflare AI / Hugging Face response shapes elsewhere, which are
 * inferred with much less certainty.
 */

export interface SupabaseResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export interface SupabaseFilterBuilder<T> extends PromiseLike<SupabaseResult<T[]>> {
  eq(column: string, value: unknown): SupabaseFilterBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): SupabaseFilterBuilder<T>;
  limit(n: number): SupabaseFilterBuilder<T>;
  select(columns?: string): SupabaseFilterBuilder<T>;
  single(): PromiseLike<SupabaseResult<T>>;
}

export interface SupabaseTableBuilder<T> {
  select(columns?: string): SupabaseFilterBuilder<T>;
  insert(values: Record<string, unknown>): SupabaseFilterBuilder<T>;
  update(values: Record<string, unknown>): SupabaseFilterBuilder<T>;
}

export interface SupabaseClientLike {
  from<T = Record<string, unknown>>(table: string): SupabaseTableBuilder<T>;
  rpc<T = unknown>(fn: string, params: Record<string, unknown>): PromiseLike<SupabaseResult<T>>;
}
