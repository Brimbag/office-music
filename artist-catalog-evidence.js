/* Read-only catalogue comparison. A proposal is evidence, never a confirmed identity. */
globalThis.OfficeArtistCatalogEvidence = (() => {
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id);
  const text = value => typeof value === 'string' ? value : '';
  const key = value => text(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
  const mbid = value => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text(value)) ? value.toLowerCase() : '';
  function metadata(raw) {
    const album = text(raw?.album) || text(raw?.album?.['#text']) || text(raw?.album?.name);
    const artistName = text(raw?.artist) || text(raw?.artist?.name) || text(raw?.artist?.['#text']);
    return { artistName, trackName: text(raw?.name) || text(raw?.track), album: album.length <= 300 ? album : '', artistMbid: mbid(raw?.artist?.mbid), trackMbid: mbid(raw?.mbid) };
  }
  function mergeMetadata(old, incoming) {
    const records = new Map();
    for (const row of [...(Array.isArray(old) ? old : []), incoming]) {
      const album = text(row?.album);
      const value = { artistName: text(row?.artistName), trackName: text(row?.trackName), album: album.length <= 300 ? album : '', artistMbid: mbid(row?.artistMbid), trackMbid: mbid(row?.trackMbid) };
      if (value.album || value.artistMbid || value.trackMbid) records.set(JSON.stringify(value), value);
    }
    // Bounded, optional cache data; truncation itself is reported, not treated as certainty.
    return { records: [...records.values()].slice(-4), truncated: records.size > 4 };
  }
  function analyze({ spotifyTracks = [], lastfmTracks = [], lastfmArtists = [], wrongArtistIds = [] } = {}) {
    const groups = new Map();
    function group(name) {
      const nameKey = key(name);
      if (!nameKey) return null;
      if (!groups.has(nameKey)) groups.set(nameKey, { name: text(name), nameKey, lastfm: false, songs: new Map(), mbids: new Set(), recordings: new Map(), truncated: false, catalogs: new Map() });
      else if (text(name) < groups.get(nameKey).name) groups.get(nameKey).name = text(name);
      return groups.get(nameKey);
    }
    for (const row of lastfmArtists) {
      const g = group(row?.artist); if (!g) continue;
      g.lastfm = true;
      for (const id of Array.isArray(row.catalogMbids) ? row.catalogMbids : []) if (mbid(id)) g.mbids.add(mbid(id));
      g.truncated ||= Boolean(row.catalogEvidenceTruncated);
    }
    for (const row of lastfmTracks) {
      const g = group(row?.artist), titleKey = key(row?.track);
      if (!g || !titleKey) continue;
      g.lastfm = true;
      if (!g.songs.has(titleKey)) g.songs.set(titleKey, { title: row.track, albums: new Set() });
      else if (row.track < g.songs.get(titleKey).title) g.songs.get(titleKey).title = row.track;
      for (const e of Array.isArray(row.catalogEvidence) ? row.catalogEvidence : []) {
        // Legacy pool keys remove punctuation/accents; require the original source spelling.
        if (key(e?.artistName) !== g.nameKey || key(e?.trackName) !== titleKey) continue;
        if (text(e?.album).length <= 300 && key(e?.album)) g.songs.get(titleKey).albums.add(key(e.album));
        if (mbid(e?.artistMbid)) g.mbids.add(mbid(e.artistMbid));
        if (mbid(e?.trackMbid)) {
          const id = mbid(e.trackMbid);
          if (!g.recordings.has(id)) g.recordings.set(id, new Set());
          g.recordings.get(id).add(titleKey);
        }
      }
      g.truncated ||= Boolean(row.catalogEvidenceTruncated);
    }
    for (const track of spotifyTracks) {
      const titleKey = key(track?.name);
      if (!titleKey || !Array.isArray(track?.artists)) continue;
      const artists = new Map();
      for (const artist of track.artists) {
        // An incomplete duet must not be mistaken for a solo recording.
        if (!validId(artist?.id) || !key(artist?.name)) continue;
        artists.set(artist.id, artist);
      }
      const solo = track.artists.length === 1 && artists.size === 1;
      for (const artist of artists.values()) {
        const g = group(artist.name);
        if (!g.catalogs.has(artist.id)) g.catalogs.set(artist.id, { id: artist.id, name: artist.name, songs: new Map(), collaborations: new Set() });
        const catalog = g.catalogs.get(artist.id);
        if (artist.name < catalog.name) catalog.name = artist.name;
        if (!solo) { catalog.collaborations.add(titleKey); continue; }
        if (!catalog.songs.has(titleKey)) catalog.songs.set(titleKey, new Set());
        if (key(track?.album?.name)) catalog.songs.get(titleKey).add(key(track.album.name));
      }
    }
    const wrong = new Set(wrongArtistIds), rows = [];
    for (const g of groups.values()) {
      const catalogs = [...g.catalogs.values()].sort((a, b) => a.id.localeCompare(b.id)).map(c => {
        const matches = [];
        for (const [titleKey, albums] of c.songs) {
          const lf = g.songs.get(titleKey); if (!lf) continue;
          const commonAlbums = [...albums].filter(album => lf.albums.has(album)).sort();
          matches.push({ title: lf.title, albums: commonAlbums });
        }
        matches.sort((a, b) => key(a.title).localeCompare(key(b.title)));
        return { id: c.id, name: c.name, matches, matchedTitles: matches.length, albumMatchedTitles: matches.filter(m => m.albums.length).length, collaborationMatches: [...c.collaborations].filter(title => g.songs.has(title)).length, reportedWrong: wrong.has(c.id) };
      });
      const overlapping = catalogs.filter(c => c.matchedTitles > 0);
      let status = 'name_only', suggestedId = null;
      if (!g.lastfm) status = 'missing_lastfm';
      else if (!catalogs.length) status = 'missing_spotify';
      else if (g.mbids.size > 1 || g.truncated || [...g.recordings.values()].some(titles => titles.size > 1)) status = 'lastfm_ambiguous';
      else if (overlapping.length > 1) status = 'ambiguous';
      else if (overlapping.length === 1) {
        const c = overlapping[0];
        if (c.matchedTitles >= 2 && c.albumMatchedTitles >= 2) {
          status = c.reportedWrong ? 'negative_conflict' : 'supported';
          if (status === 'supported') suggestedId = c.id;
        } else status = 'insufficient';
      } else if (catalogs.some(c => c.collaborationMatches)) status = 'collaboration_only';
      rows.push({ name: g.name, nameKey: g.nameKey, lastfm: g.lastfm, lastfmTitles: g.songs.size, lastfmMbids: [...g.mbids].sort(), status, suggestedId, catalogs });
    }
    rows.sort((a, b) => a.nameKey.localeCompare(b.nameKey));
    const lfRows = rows.filter(r => r.lastfm), statuses = {};
    for (const row of rows) statuses[row.status] = (statuses[row.status] || 0) + 1;
    return { version: 1, mode: 'diagnostic', rows, summary: {
      lastfmNames: lfRows.length,
      spotifyNames: rows.filter(r => r.catalogs.length).length,
      spotifyCatalogs: rows.reduce((n, r) => n + r.catalogs.length, 0),
      lastfmNamesWithSpotify: lfRows.filter(r => r.catalogs.length).length,
      multiIdNames: rows.filter(r => r.catalogs.length > 1).length,
      proposals: statuses.supported || 0,
      coverage: lfRows.length ? (statuses.supported || 0) / lfRows.length : 0,
      negativeContradictions: statuses.negative_conflict || 0,
      verifiedFalseMatchRate: null,
      statuses
    } };
  }
  return { key, metadata, mergeMetadata, analyze };
})();
