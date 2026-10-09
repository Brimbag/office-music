/* Pure, bounded repair of a selected set. Callers supply already safe candidates.
 * Identity/signature/artist constraints are preserved; no storage or API access. */
(function (root) {
  function repair({ selected, candidates, total, quota }) {
    const rank = (a, b) => b.score - a.score || a.order - b.order;
    const onlyDiscovery = quota(total).target === 1;
    const ordered = candidates.filter(row => !onlyDiscovery || row.discovery).sort(rank);
    const known = ordered.filter(row => !row.discovery);
    const discoveries = ordered.filter(row => row.discovery);
    const index = rows => {
      const state = { ids: new Set(), signatures: new Set(), counts: new Map() };
      for (const row of rows) addToIndex(row, state);
      return state;
    };
    const addToIndex = (row, state) => {
      state.ids.add(row.id);
      for (const signature of row.signatures) state.signatures.add(signature);
      for (const artist of row.artists) state.counts.set(artist, (state.counts.get(artist) || 0) + 1);
    };
    const fits = (row, state) => !state.ids.has(row.id) &&
      !row.signatures.some(key => state.signatures.has(key)) &&
      !row.artists.some(key => (state.counts.get(key) || 0) >= 2);
    const discoveryCount = rows => rows.filter(row => row.discovery).length;
    const valid = rows => discoveryCount(rows) <= quota(rows.length).max &&
      (!onlyDiscovery || rows.every(row => row.discovery));
    const summarize = rows => {
      const oldIds = new Set(selected.map(row => row.id)), newIds = new Set(rows.map(row => row.id));
      return { rows, beforeLength: selected.length, beforeDiscovery: discoveryCount(selected),
        afterLength: rows.length, afterDiscovery: discoveryCount(rows),
        added: rows.filter(row => !oldIds.has(row.id)).length,
        removed: selected.filter(row => !newIds.has(row.id)).length,
        minimumShortfall: Math.max(0, quota(rows.length).min - discoveryCount(rows)) };
    };
    if (selected.length === total && valid(selected)) return summarize([...selected]);
    const addKnown = rows => {
      const state = index(rows);
      for (const row of known) {
        if (rows.length >= total) break;
        if (fits(row, state)) { rows.push(row); addToIndex(row, state); }
      }
    };
    const addDiscoveries = rows => {
      const state = index(rows);
      let count = discoveryCount(rows);
      for (const row of discoveries) {
        if (rows.length >= total) break;
        if (count + 1 > quota(rows.length + 1).max) break;
        if (fits(row, state)) { rows.push(row); addToIndex(row, state); count++; }
      }
    };
    // Fill with safe known tracks before replacing/removing an existing discovery.
    const repaired = selected.filter(row => !onlyDiscovery || row.discovery);
    addKnown(repaired);
    while (!valid(repaired)) {
      const victims = repaired.filter(row => row.discovery).sort((a, b) => rank(b, a));
      let replaced = false;
      const selectedIds = new Set(repaired.map(row => row.id));
      const alternatives = known.filter(row => !selectedIds.has(row.id));
      for (const victim of alternatives.length ? victims : []) {
        const rest = repaired.filter(row => row !== victim);
        const state = index(rest);
        const replacement = alternatives.find(row => fits(row, state));
        if (!replacement) continue;
        repaired[repaired.indexOf(victim)] = replacement;
        replaced = true;
        break;
      }
      if (!replaced) repaired.splice(repaired.indexOf(victims[0]), 1);
      addKnown(repaired);
    }
    addDiscoveries(repaired);
    // A discovery/coartist may consume slots needed by several known tracks.
    // Rebuild two bounded alternatives, not just trim the original greedy set.
    const completeKnownSeed = seed => {
      const rows = [], state = index([]);
      for (const row of seed) {
        if (rows.length >= total) break;
        if (fits(row, state)) { rows.push(row); addToIndex(row, state); }
      }
      addKnown(rows);
      addDiscoveries(rows);
      return rows;
    };
    // Respect soft spacing later in the existing listening-order pass.
    const plans = [repaired, completeKnownSeed(onlyDiscovery ? [] : selected.filter(row => !row.discovery)), completeKnownSeed([])];
    const quality = rows => rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
    const distance = rows => rows.length ? Math.abs(discoveryCount(rows) / rows.length - quota(rows.length).target) : 0;
    const selectedKnownIds = new Set(selected.filter(row => !row.discovery).map(row => row.id));
    const preservesKnown = rows => {
      const ids = new Set(rows.map(row => row.id));
      return [...selectedKnownIds].every(id => ids.has(id));
    };
    let best = repaired;
    for (const plan of plans) {
      if (!valid(plan)) continue;
      if (plan.length > best.length) { best = plan; continue; }
      if (plan.length !== best.length) continue;
      const gain = quality(plan) - quality(best);
      // Similar quality means at most one existing groupBase point per track.
      // Never drop a good selected known track only to improve the percentage.
      if (gain > 1 || (Math.abs(gain) <= 1 && preservesKnown(plan) && distance(plan) < distance(best))) best = plan;
    }
    // Preserve the original order and dynamic details when it already satisfies
    // quota and no longer plan exists. Repairs are not a general reranker.
    if (valid(selected) && selected.length === best.length) best = [...selected];
    return summarize(best);
  }
  root.OfficeDiscoveryQuota = Object.freeze({ repair });
})(globalThis);
