/**
 * Embedding range constants — pure module, no fs / DB / Electron.
 *
 * Split from `src/lib/embedding.ts` so renderer-side consumers
 * (`vex-app/src/shared/schemas/embedding.ts`, `EmbeddingStep.tsx`)
 * don't end up importing `node:fs` transitively. The reader-side
 * function `readEmbeddingDefaultsFromExample` stays in `embedding.ts`
 * and is consumed only by main-process code.
 */

export const MIN_EMBEDDING_DIM = 1;
export const MAX_EMBEDDING_DIM = 8192;
