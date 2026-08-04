# @adaprio/shared-types

API request/response/error/adapter contracts shared between `apps/api` and
`packages/sdk-ts` (Handbook Ch 33.1, 33.1.2). Zero runtime dependencies —
types only, erased at compile time (Ch 33.1.3).

## Files

| File | Contents | Handbook refs |
|---|---|---|
| `src/entity-keys.generated.ts` | The frozen 60-key taxonomy as a TS union type. **Generated** — do not hand-edit. | Ch 08, 25-A |
| `src/memory.ts` | Core domain types: `Certainty`, `LifecycleState`, `TtlPolicy`, `ExtractedMemory`/`LLMResponse` (write path), `RetrievedMemory`/`Explainability` (read path), `MemoryEvent` (audit) | Ch 04.3, 06, 07.6, 09 |
| `src/api.ts` | Request/response types for all 5 endpoints, the error response shape, rate limit tiers | Ch 10 |
| `src/adapters.ts` | `LLMAdapter`, `EmbeddingAdapter`, `RerankerAdapter`, `DatabaseAdapter` interfaces | Ch 31 |
| `src/index.ts` | Barrel — the only import path other packages should use | Ch 33.1.3 |

## Regenerating the entity key taxonomy

```bash
npm run generate   # writes src/entity-keys.generated.ts
npm run typecheck  # regenerates + type-checks
```

`scripts/generate-entity-keys.cjs` must stay in sync with
`packages/db/seed/generate-entity-registry-seed.js` — see the source-of-truth
note at the top of that script. This is a known maintenance risk (two
generators, one list) rather than a settled design; unifying them is a
reasonable follow-up once both packages exist side by side in the monorepo.

## ⚠️ Two ambiguities flagged, not silently resolved

Per the "propose the smallest extension, don't invent contradicting
architecture" instruction, these were implemented with the most
handbook-consistent interpretation available, but both are marked in code
comments for explicit confirmation:

1. **Two error code schemes (Ch 10.6 vs Ch 28).** The handbook defines nine
   wire-level `SCREAMING_SNAKE_CASE` codes (Ch 10.6, shown in every Ch 10.10
   example) and, separately, 38 granular `AMM####` codes (Ch 28) — with no
   stated mapping between them. This package treats `ApiErrorCode` (the nine)
   as the only thing ever serialized to a client, and `InternalErrorCode`
   (the 38) as server-side-only classification for logs/metrics, with a
   proposed `INTERNAL_TO_API_ERROR_CODE` mapping in `api.ts`. **Confirm this
   before building SDK error-mapping logic (Ch 11.2) against it.**

2. **`DatabaseAdapter` vs the repository pattern (Ch 31.4 vs Ch 9.9).** Ch
   31.4 originally specified a generic `executeGovernanceTransaction(ops)`
   method; Ch 9.9 (added in v1.2.0) instead shows each conflict rule as a
   named Postgres function called via `.rpc()` from domain-named repository
   methods. This package follows Ch 9.9 (more recent, more detailed, working
   SQL shown) and drops the generic ops-array method — `DatabaseAdapter` here
   is a thin wrapper (`rpc()`, `vectorSearch()`, `metadataSearch()`,
   `updateReinforcement()`) that the repository layer
   (`apps/api/src/repositories/`, not in this package) builds on. **Confirm
   this reconciliation before implementing the repository layer.**
