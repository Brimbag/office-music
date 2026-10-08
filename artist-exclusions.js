/* A small journal of user exclusions; no Spotify/Last.fm identity migration. */
globalThis.OfficeArtistExclusions = (() => {
  const KEY = 'office_artist_exclusions_v1';
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id);
  function parse(raw) {
    if (raw === null || raw === undefined) return { version: 1, artists: {} };
    const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!state || state.version !== 1 || !state.artists || typeof state.artists !== 'object' || Array.isArray(state.artists)) throw new Error('Nieprawidłowe dane blokad wykonawców.');
    for (const [artistId, events] of Object.entries(state.artists)) {
      if (!validId(artistId) || !Array.isArray(events) || events.some(e => !e || typeof e.id !== 'string' || !e.id || !Array.isArray(e.parents) || e.parents.some(p => typeof p !== 'string') || !Object.hasOwn(e, 'value'))) throw new Error('Nieprawidłowa historia blokady.');
      const map = new Map(events.map(e => [e.id, e]));
      if (map.size !== events.length) throw new Error('Powtórzony identyfikator decyzji.');
      const children = new Map(), degrees = new Map();
      for (const e of events) {
        if (e.value !== null && (!e.value || e.value.artistId !== artistId || !['dislike', 'wrong_artist'].includes(e.value.reason) || typeof e.value.name !== 'string' || typeof e.value.trackId !== 'string' || typeof e.value.trackName !== 'string' || !Array.isArray(e.value.artists) || e.value.artists.some(a => !a || typeof a.id !== 'string' || typeof a.name !== 'string') || !Number.isFinite(Date.parse(e.value.updatedAt)) || e.value.source !== 'playlist_block')) throw new Error('Nieprawidłowy powód blokady.');
        if (new Set(e.parents).size !== e.parents.length || e.parents.some(p => !map.has(p))) throw new Error('Niepełna historia blokady.');
        degrees.set(e.id, e.parents.length);
        for (const parent of e.parents) {
          if (!children.has(parent)) children.set(parent, []);
          children.get(parent).push(e.id);
        }
      }
      const ready = events.filter(e => !e.parents.length).map(e => e.id);
      let visited = 0;
      while (ready.length) {
        const id = ready.pop(); visited++;
        for (const child of children.get(id) || []) {
          degrees.set(child, degrees.get(child) - 1);
          if (!degrees.get(child)) ready.push(child);
        }
      }
      if (visited !== events.length) throw new Error('Cykliczna historia blokady.');
    }
    return state;
  }
  function heads(events = []) {
    const parents = new Set(events.flatMap(e => e.parents));
    return events.filter(e => !parents.has(e.id));
  }
  function status(state, artistId) {
    const latest = heads(state.artists[artistId]);
    const active = latest.filter(e => e.value !== null);
    return { blocked: active.length > 0, conflict: latest.length > 1, entries: active.map(e => e.value) };
  }
  function merge(a, b) {
    a = parse(a); b = parse(b);
    const artists = {};
    for (const id of [...new Set([...Object.keys(a.artists), ...Object.keys(b.artists)])].sort()) {
      const events = new Map();
      for (const e of [...(a.artists[id] || []), ...(b.artists[id] || [])]) {
        if (events.has(e.id) && JSON.stringify(events.get(e.id)) !== JSON.stringify(e)) throw new Error('Sprzeczne dane tej samej decyzji.');
        events.set(e.id, e);
      }
      artists[id] = [...events.values()].sort((x, y) => x.id.localeCompare(y.id));
    }
    return { version: 1, artists };
  }
  function decide(state, artistId, value, eventId = crypto.randomUUID()) {
    state = parse(state);
    const events = state.artists[artistId] || [];
    return parse({ version: 1, artists: { ...state.artists, [artistId]: [...events, { id: eventId, parents: heads(events).map(e => e.id), value }] } });
  }
  return { KEY, validId, parse, heads, status, merge, decide };
})();
