/**
 * ⚠️ SANDBOX-ONLY STUB. This file and the corresponding `paths` entry in
 * tsconfig.json exist only because this codebase was built without
 * network access to run `npm install @supabase/supabase-js`. It lets
 * `src/index.ts`'s `import { createClient } from '@supabase/supabase-js'`
 * type-check against SOMETHING, so the rest of that file's logic could be
 * verified for real.
 *
 * DELETE this file and the matching tsconfig.json `paths` entry once
 * `@supabase/supabase-js` is added as a real dependency — at that point
 * TypeScript should resolve the real package from node_modules, and this
 * stub would otherwise silently keep shadowing it.
 */
import type { SupabaseClientLike } from './adapters/database/supabase-client-types.js';

export declare function createClient(url: string, key: string): SupabaseClientLike;
