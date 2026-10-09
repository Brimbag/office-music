// Read-only audit helpers. Callers supply normalized identities and copies of records.
export function auditPool(before, after, offeredKeys = []) {
  const a = new Map(before.map(r => [r.key, r.value]));
  const b = new Map(after.map(r => [r.key, r.value]));
  const offered = new Set(offeredKeys);
  const added = [...b.keys()].filter(k => !a.has(k));
  const removed = [...a.keys()].filter(k => !b.has(k));
  const updated = [...b.keys()].filter(k => a.has(k) && offered.has(k));
  const changed = [...b.keys()].filter(k => a.has(k) && JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k)));
  return { before: a.size, after: b.size, offeredUnique: offered.size,
    newOffered: [...offered].filter(k => !a.has(k)).length,
    added: added.length, updated: updated.length, changed: changed.length,
    removed: removed.length, rejectedNew: [...offered].filter(k => !a.has(k) && !b.has(k)).length,
    addedKeys: added, removedKeys: removed };
}

// An illustrative retention candidate, used only on test copies; never in the app.
export function balancedRetention(rows, limit) {
  const ordered = [...rows].sort((a, b) => Number(b.valuable) - Number(a.valuable) || b.savedAt - a.savedAt || a.key.localeCompare(b.key));
  const kept = [], seenArtists = new Set(), seenRows = new Set();
  for (const row of ordered) {
    if (kept.length >= limit) break;
    if (seenArtists.has(row.artist) || seenRows.has(row.key)) continue;
    kept.push(row); seenArtists.add(row.artist); seenRows.add(row.key);
  }
  for (const row of ordered) {
    if (kept.length >= limit) break;
    if (seenRows.has(row.key)) continue;
    kept.push(row); seenRows.add(row.key);
  }
  return kept;
}
