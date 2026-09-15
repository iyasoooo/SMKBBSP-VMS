/**
 * Server startup hook.
 *
 * Next.js compiles this file for *every* runtime it builds, the edge one
 * included, and calls `register` once per server process.
 *
 * That is why the real work lives in `instrumentation-node.ts` and is reached
 * only from inside the condition below. The check has to wrap the import rather
 * than guard it with an early return: webpack replaces `process.env.NEXT_RUNTIME`
 * with a literal per bundle, so an import nested inside a branch that is
 * statically false is dropped from the edge bundle entirely - while an early
 * return leaves the import reachable and pulls the mail transport in after it.
 * The edge runtime has no `stream`, `fs`, `path` or `crypto`, so that is a
 * build failure rather than something discovered later.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
