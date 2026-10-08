/* Pure retention/rotation policy. It never changes scores or preferences. */
globalThis.OfficePoolRetention = (() => {
  const compare = (a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0) || a.key.localeCompare(b.key);
  function retain(entries, limit) {
    const byKey = new Map();
    for (const entry of entries) {
      if (!entry?.key) continue;
      const previous = byKey.get(entry.key);
      if (!previous || compare(entry, previous) < 0) byKey.set(entry.key, entry);
    }
    const rows = [...byKey.values()].sort(compare);
    if (rows.length <= limit) return rows.map(e => e.row);
    const chosen = new Map();
    const add = e => { if (chosen.size < limit) chosen.set(e.key, e); };
    for (const priority of [true, false]) {
      const tier = rows.filter(e => Boolean(e.protected) === priority);
      // Reserve one representative for each profile/genre before filling extras.
      const covered = new Set();
      for (const entry of tier) {
        if ((entry.coverage || []).some(key => !covered.has(key))) {
          add(entry); (entry.coverage || []).forEach(key => covered.add(key));
        }
      }
      const groups = new Map();
      for (const entry of tier) {
        const artist = entry.artist || entry.key;
        if (!groups.has(artist)) groups.set(artist, []);
        groups.get(artist).push(entry);
      }
      const queues = [...groups.values()];
      let round = 0, remaining = true;
      while (chosen.size < limit && remaining) {
        remaining = false;
        for (const queue of queues) {
          if (round < queue.length) { remaining = true; add(queue[round]); }
        }
        round++;
      }
    }
    return [...chosen.values()].sort(compare).map(e => e.row);
  }
  function rotate(entries, limit, cursor = 0) {
    const groups = new Map();
    for (const entry of [...entries].sort(compare)) {
      const artist = entry.artist || entry.key;
      if (!groups.has(artist)) groups.set(artist, []);
      groups.get(artist).push(entry);
    }
    const artists = [...groups.keys()].sort();
    if (!artists.length || limit <= 0) return { rows: [], cursor };
    const start = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
    const rows = [], seen = new Set();
    const maxAttempts = artists.length * Math.max(...[...groups.values()].map(group => group.length));
    let attempts = 0;
    for (let i = 0; i < maxAttempts && rows.length < limit; i++) {
      attempts++;
      const position = start + i, group = groups.get(artists[position % artists.length]);
      const entry = group[Math.floor(position / artists.length) % group.length];
      if (seen.has(entry.key)) continue;
      seen.add(entry.key); rows.push(entry.row);
    }
    return { rows, cursor: start + attempts };
  }
  return { retain, rotate };
})();
