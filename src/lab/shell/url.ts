/** Shared, debounced URL query state: the host and every tool own disjoint keys. */
const pendingPatch = new Map<string, string | null>();
let timer = 0;

export function getParam(key: string): string | null {
  return new URLSearchParams(location.search).get(key);
}

/** Sets (or, with null, removes) query keys. Writes are batched into one history.replaceState. */
export function setParams(patch: Record<string, string | null>): void {
  for (const [k, v] of Object.entries(patch)) pendingPatch.set(k, v);
  window.clearTimeout(timer);
  timer = window.setTimeout(flush, 250);
}

function flush(): void {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of pendingPatch) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  pendingPatch.clear();
  const s = q.toString();
  history.replaceState(null, '', `${location.pathname}${s ? `?${s}` : ''}`);
}
