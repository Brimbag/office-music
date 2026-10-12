/* Ephemeral aggregate counters only: no cache keys, queries, or persistence. */
(function (root) {
  const reasons = ['ttl', 'quota', 'invalid', 'migration', 'import'];
  const counts = Object.fromEntries(reasons.map(reason => [reason, { spotify: 0, lastfm: 0 }]));
  const service = key => String(key).startsWith('office_search_cache_v1:') ? 'spotify'
    : String(key).startsWith('office_lastfm_cache_v1:') ? 'lastfm' : null;
  function remove(storage, key, reason) {
    let existed = false;
    try { existed = storage.getItem(key) !== null; } catch {} // Observation must not change removal semantics.
    storage.removeItem(key); // A failed removal is not counted; its error remains visible to the caller.
    const kind = service(key);
    if (existed && kind && counts[reason]) counts[reason][kind]++;
  }
  const report = () => Object.fromEntries(reasons.map(reason => [reason, { ...counts[reason] }]));
  root.OmmCacheDiagnostics = Object.freeze({ remove, report });
})(globalThis);
