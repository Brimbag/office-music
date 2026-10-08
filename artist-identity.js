/* Shared, additive v2 state. Values are explicit decisions, never name inference. */
globalThis.OfficeArtistIdentity = (() => {
  const KEY = 'office_artist_identity_v2';
  function parse(raw) {
    if (raw === null || raw === undefined) return { version: 2, cells: {} };
    const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!state || state.version !== 2 || !state.cells || Array.isArray(state.cells) || typeof state.cells !== 'object') {
      throw new Error('Nieprawidłowy rejestr tożsamości wykonawców. Przywróć kopię bazy.');
    }
    for (const events of Object.values(state.cells)) {
      if (!Array.isArray(events) || events.some(e => !e || typeof e.id !== 'string' || !Array.isArray(e.parents) || e.parents.some(p => typeof p !== 'string') || !Object.hasOwn(e, 'value'))) {
        throw new Error('Nieprawidłowy zapis decyzji o wykonawcy.');
      }
      const byId = new Map(events.map(e => [e.id, e]));
      if (byId.size !== events.length) throw new Error('Powtórzony identyfikator decyzji.');
      const children = new Map(), degrees = new Map();
      for (const event of events) {
        if (new Set(event.parents).size !== event.parents.length || event.parents.some(id => !byId.has(id))) throw new Error('Niepełna historia decyzji.');
        degrees.set(event.id, event.parents.length);
        for (const parent of event.parents) {
          if (!children.has(parent)) children.set(parent, []);
          children.get(parent).push(event.id);
        }
      }
      const ready = events.filter(e => !e.parents.length).map(e => e.id);
      let checked = 0;
      while (ready.length) {
        const id = ready.pop(); checked++;
        for (const child of children.get(id) || []) {
          degrees.set(child, degrees.get(child) - 1);
          if (degrees.get(child) === 0) ready.push(child);
        }
      }
      if (checked !== events.length) throw new Error('Cykliczna historia decyzji.');
    }
    return state;
  }
  function heads(events = []) {
    const superseded = new Set(events.flatMap(e => e.parents));
    return events.filter(e => !superseded.has(e.id));
  }
  function read(state, key) {
    const latest = heads(state.cells[key]);
    return { value: latest.length === 1 ? latest[0].value : null, conflict: latest.length > 1, exists: latest.length > 0 };
  }
  function merge(a, b) {
    a = parse(a); b = parse(b);
    const cells = Object.create(null);
    for (const key of [...new Set([...Object.keys(a.cells), ...Object.keys(b.cells)])].sort()) {
      const events = new Map();
      for (const event of [...(a.cells[key] || []), ...(b.cells[key] || [])]) {
        if (events.has(event.id) && JSON.stringify(events.get(event.id)) !== JSON.stringify(event)) throw new Error('Konflikt identyfikatora decyzji.');
        events.set(event.id, event);
      }
      cells[key] = [...events.values()].sort((x, y) => x.id.localeCompare(y.id));
    }
    return { version: 2, cells };
  }
  function decide(state, key, value, id = crypto.randomUUID()) {
    state = parse(state);
    return { version: 2, cells: { ...state.cells, [key]: [
      ...(state.cells[key] || []),
      { id, parents: heads(state.cells[key]).map(e => e.id), value, updatedAt: new Date().toISOString() }
    ] } };
  }
  function artistKey(artist) {
    return artist?.id ? `spotify:artist:${artist.id}` : '';
  }
  function spotifyId(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(?:https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?artist\/|spotify:artist:)?([A-Za-z0-9]{22})(?:\?[^\s]*)?$/);
    if (!match) throw new Error('Podaj Spotify Artist ID lub link https://open.spotify.com/artist/…');
    return match[1];
  }
  return { KEY, parse, heads, read, merge, decide, artistKey, spotifyId };
})();
