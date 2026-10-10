/* LF2: bounded candidate catalog, never a history or a freshness observation. */
(function (root) {
  const KEY = 'office_lastfm_compact_v1', MAX_BYTES = 128 * 1024, TTL = 45 * 86400000;
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const name = value => String(value || '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  const key = row => JSON.stringify([name(row.artist), name(row.track)]);
  const text = (value, max = 300) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\p{Control}]/u.test(value);
  const unique = (values, max, length) => [...new Set((Array.isArray(values) ? values : []).filter(v => text(v, length)))].sort().slice(0, max);
  const mbid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  function clean(row, track, now) {
    if (!row || !text(row.artist) || (track && !text(row.track)) || !Number.isSafeInteger(row.savedAt) || row.savedAt < now - TTL || row.savedAt > now + 300000) return null;
    const result = { artist: row.artist, ...(track ? { track: row.track } : {}), savedAt: row.savedAt,
      tags: unique(row.tags, 20, 64), sources: unique(row.sources, 8, 64) };
    if (track && Array.isArray(row.catalogEvidence)) {
      const records = row.catalogEvidence.map(record => Object.fromEntries(['artistName', 'trackName', 'album', 'artistMbid', 'trackMbid']
        .filter(field => text(record?.[field]) && (!field.endsWith('Mbid') || mbid(record[field])))
        .map(field => [field, record[field]]))).filter(record => Object.keys(record).length);
      const evidence = [...new Map(records.map(record => [JSON.stringify(record), record])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
      if (evidence.length) result.catalogEvidence = evidence.slice(0, 4);
      if (evidence.length > 4) result.catalogEvidenceTruncated = true;
    } else if (!track && Array.isArray(row.catalogMbids)) {
      const ids = [...new Set(row.catalogMbids.filter(mbid))].sort();
      if (ids.length) result.catalogMbids = ids.slice(0, 4);
      if (ids.length > 4) result.catalogEvidenceTruncated = true;
    }
    if (row.catalogEvidenceTruncated) result.catalogEvidenceTruncated = true;
    return result;
  }
  function mergeRows(left, right, track, now = Date.now()) {
    const map = new Map();
    for (const row of [...left, ...right]) {
      const incoming = clean(row, track, now); if (!incoming) continue;
      const id = key(incoming), old = map.get(id);
      if (!old) { map.set(id, incoming); continue; }
      const newest = incoming.savedAt > old.savedAt || incoming.savedAt === old.savedAt && JSON.stringify(incoming).localeCompare(JSON.stringify(old), 'en') < 0 ? incoming : old;
      map.set(id, clean({ ...newest, tags: [...old.tags, ...incoming.tags], sources: [...old.sources, ...incoming.sources],
        catalogMbids: [...(old.catalogMbids || []), ...(incoming.catalogMbids || [])],
        catalogEvidence: [...(old.catalogEvidence || []), ...(incoming.catalogEvidence || [])],
        catalogEvidenceTruncated: old.catalogEvidenceTruncated || incoming.catalogEvidenceTruncated }, track, now));
    }
    return [...map.values()].sort((a, b) => b.savedAt - a.savedAt || key(a).localeCompare(key(b), 'en'));
  }
  function compact(user, artists, tracks, now = Date.now()) {
    const result = { version: 1, user: name(user), artists: [], tracks: [] };
    // Round-robin artists in each catalog; do not let one prolific artist fill the byte budget.
    const queues = [mergeRows([], artists, false, now), mergeRows([], tracks, true, now)].map(rows => {
      const groups = new Map();
      for (const row of rows) { const id = name(row.artist); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(row); }
      const ordered = []; let pending = true;
      while (pending) { pending = false; for (const group of groups.values()) if (group.length) { ordered.push(group.shift()); pending = true; } }
      return ordered;
    });
    let used = bytes(result);
    for (let i = 0; i < Math.max(...queues.map(q => q.length)); i++) for (let kind = 0; kind < 2; kind++) {
      const row = queues[kind][i]; if (!row) continue;
      const target = kind ? result.tracks : result.artists, cost = bytes(row) + (target.length ? 1 : 0);
      if (used + cost > MAX_BYTES) continue;
      target.push(row); used += cost;
    }
    return result;
  }
  function valid(value, now = Date.now()) {
    if (!value || value.version !== 1 || typeof value.user !== 'string' || value.user.length > 100 || value.user !== name(value.user) || /[\p{Control}]/u.test(value.user) ||
        Object.keys(value).sort().join() !== 'artists,tracks,user,version' || !Array.isArray(value.artists) || !Array.isArray(value.tracks) || value.artists.length > 1800 || value.tracks.length > 3000 || bytes(value) > MAX_BYTES) return false;
    for (const [track, rows] of [[false, value.artists], [true, value.tracks]]) {
      const seen = new Set();
      for (const row of rows) {
        // Expired rows can be read and removed by merge; future or malformed rows cannot.
        const cleaned = clean(row, track, Math.min(now, Number(row?.savedAt) + TTL));
        if (!cleaned || Number(row.savedAt) > now + 300000 || !same(row, cleaned) || seen.has(key(row))) return false;
        seen.add(key(row));
      }
    }
    return true;
  }
  function same(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  function merge(local, remote, now = Date.now()) {
    if (remote && remote.user !== local.user) throw new Error('Baza Last.fm w chmurze dotyczy innego konta. Dane pozostawiono bez zmian.');
    return compact(local.user, mergeRows(local.artists, remote?.artists || [], false, now), mergeRows(local.tracks, remote?.tracks || [], true, now), now);
  }
  root.OfficeLastFmCloud = Object.freeze({ KEY, MAX_BYTES, TTL, bytes, name, key, compact, merge, mergeRows, valid, same });
})(globalThis);
