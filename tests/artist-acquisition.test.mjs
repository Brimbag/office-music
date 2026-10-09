import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startBrowserHarness } from './helpers/browser.mjs';
// Replay the deployed acquisition policy on the very same fixture and API responses.
const { sources: baselineSources } = JSON.parse(readFileSync(new URL('./fixtures/acquisition-v43.15.json', import.meta.url), 'utf8'));
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(run, arg) {
  const session = await harness.page();
  try { const result = await session.page.evaluate(run, arg); assert.deepEqual(session.errors, []); return result; }
  finally { await session.close(); }
}
const ids = { A: '1111111111111111111111', B: '2222222222222222222222', C: '3333333333333333333333' };

for (const people of [2, 4]) test(`${people} profile: tyle samo wywołań, 1→3 kwalifikowalnych wykonawców i 2→6 utworów bez zmiany ocen`, async t => {
  const results = [];
  for (const policy of ['deployed', 'D']) results.push(await evaluate(async ({ people, policy, baselineSources, ids }) => {
    const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, genres: ['rock', 'jazz'], artists: [], categories: [], taste: { hasSurvey: true, likedGenres: ['Rock', 'Jazz'], okGenres: [], blockedGenres: [] } }));
    const make = (artist, n, variant = false) => ({ id: `${artist}-${n}`, uri: `spotify:track:${artist}-${n}`, name: `Song ${n}${variant ? ' - Rework' : ''}`, artists: [{ id: ids[artist], name: artist }], album: { name: 'Album' } });
    const initial = [...Array.from({ length: 4 }, (_, i) => ({ track: make('A', i), queries: ['genre:"jazz"'], savedAt: Date.now() })), ...Array.from({ length: 12 }, (_, i) => ({ track: make('B', i + 10, true), queries: ['genre:"rock"'], savedAt: Date.now() }))];
    saveCandidatePool(initial);
    addLastFmTracks(['A', 'B', 'C'].flatMap(artist => Array.from({ length: 20 }, (_, i) => ({ name: `Song ${i}`, artist: { name: artist } }))), { tags: ['rock', 'jazz'] });
    const blocks = generationBlocklists(selected), before = acquisitionCoverage(selected, blocks).artists;
    const original = searchTracks, calls = [];
    newSearchesThisGeneration = 0; maxNewSearchesThisGeneration = 1;
    searchTracks = async (_token, query) => {
      calls.push(query); newSearchesThisGeneration++;
      const tracks = query === 'genre:"jazz"' ? [make('A', 4), make('A', 5)] : [make('B', 0), make('B', 1), make('C', 0), make('C', 1)];
      addToCandidatePool(query, tracks); return tracks;
    };
    try {
      const primer = policy === 'deployed' ? eval(`(${baselineSources[1]})`) : primeProfileGenres;
      await primer('test', selected, 1);
      const ctx = buildGroupRecommendationContext(selected), { eligible, stats } = eligibleGroupCandidates(selected, blocks, ctx);
      Math.random = () => 0.25;
      const output = selectGroupPlaylist(eligible, 6, ctx, stats);
      const counts = {};
      for (const track of output.tracks) for (const artist of trackArtistKeys(track)) counts[artist] = (counts[artist] || 0) + 1;
      return { calls, before, after: acquisitionCoverage(selected, blocks).artists, length: output.tracks.length, averages: Object.values(output.satisfaction).map(row => row.average), counts, min: Math.min(...[...output.details.values()].flatMap(d => Object.values(d.byUser))) };
    } finally { searchTracks = original; }
  }, { people, policy, baselineSources, ids }));
  assert.deepEqual(results.map(r => r.calls.length), [1, 1]); assert.deepEqual(results.map(r => r.after), [1, 3]);
  assert.deepEqual(results.map(r => r.length), [2, 6]); assert.deepEqual(results[0].averages, results[1].averages);
  assert.ok(results.every(r => Object.values(r.counts).every(n => n <= 2) && r.min >= 35));
  t.diagnostic(JSON.stringify({ people, deployed: results[0], D: results[1] }));
});

test('cache przy wyczerpanym budżecie i offline: kwalifikowalne strony użyte bez fetch, pusta strona nie blokuje dalszych', async () => {
  const result = await evaluate(async ({ ids }) => {
    const selected = [{ id: 'bartek', genres: ['rock'], artists: [], categories: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    const track = { id: 'cache', uri: 'spotify:track:cache', name: 'Song', artists: [{ id: ids.B, name: 'B' }], album: { name: 'Album' } };
    addLastFmTracks([{ name: 'Song', artist: { name: 'B' } }], { tags: ['rock'] });
    writeSearchCache('genre:"rock"', 0, []); writeSearchCache('genre:"rock"', 90, [track]);
    newSearchesThisGeneration = maxNewSearchesThisGeneration;
    let fetches = 0; const original = fetch;
    window.fetch = () => { fetches++; throw new Error('Offline'); };
    try {
      const a = createCandidateAcquisition(selected);
      await primeProfileGenres('test', selected, 0, a); await primeCommonGroupQueries('test', selected, 0, a);
      return { fetches, artists: acquisitionCoverage(selected, a.blocklists).artists, cachedPages: a.cachedPages, searched: a.searched.size, pool: candidatePoolSize() };
    } finally { window.fetch = original; }
  }, { ids });
  assert.deepEqual(result, { fetches: 0, artists: 1, cachedPages: 2, searched: 0, pool: 1 });
});

test('surowe utwory wariantowe nie udają nasyconego artysty wzorcowego; dwa poprawne wystarczają', async () => {
  const result = await evaluate(async ({ ids }) => {
    const selected = [{ id: 'bartek', genres: ['rock'], artists: ['A', 'B'], categories: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    const make = (artist, n, variant) => ({ id: `${artist}-${n}`, uri: `spotify:track:${artist}-${n}`, name: `Song ${n}${variant ? ' - Rework' : ''}`, artists: [{ id: ids[artist], name: artist }] });
    saveCandidatePool(['A', 'B'].flatMap(artist => Array.from({ length: 3 }, (_, i) => ({ track: make(artist, i, artist === 'A'), queries: [`artist:"${artist}"`], savedAt: Date.now() }))));
    addLastFmArtists([{ name: 'A' }, { name: 'B' }], { tags: ['rock'] });
    const original = searchTracks, calls = [];
    searchTracks = async (_token, query) => { calls.push(query); newSearchesThisGeneration++; return []; };
    try { await primeManualSeedArtists('test', selected, 3); return calls; } finally { searchTracks = original; }
  }, { ids });
  assert.deepEqual(result, ['artist:"A"']);
});

test('jedno zapytanie nie zużywa ponownie budżetu w kolejnych etapach, cache nie markuje go jako pobranego', async () => {
  const result = await evaluate(async () => {
    const selected = [{ id: 'bartek', genres: ['rock'], artists: [], categories: [], taste: {} }], a = createCandidateAcquisition(selected), original = searchTracks, calls = [];
    writeSearchCache('genre:"rock"', 0, []);
    searchTracks = async (_token, query) => { calls.push(query); newSearchesThisGeneration++; return []; };
    try { await primeProfileGenres('test', selected, 1, a); await primeCommonGroupQueries('test', selected, 3, a); return { calls, cache: a.cachedPages }; }
    finally { searchTracks = original; }
  });
  assert.deepEqual(result, { calls: ['genre:"rock"'], cache: 1 });
});

for (const total of [60, 90, 120]) test(`cel ${total}: niezmieniony globalny i etapowy budżet przez prawdziwy searchTracks`, async () => {
  const result = await evaluate(async ({ total }) => {
    const selected = [{ id: 'bartek', genres: Array.from({ length: 20 }, (_, i) => `g${i}`), artists: Array.from({ length: 20 }, (_, i) => `Artist ${i}`), categories: [], taste: {} }];
    newSearchesThisGeneration = 0; maxNewSearchesThisGeneration = searchBudgetForTarget(total);
    const a = createCandidateAcquisition(selected), original = fetch, gap = waitForSearchSlot;
    let calls = 0; waitForSearchSlot = async () => {};
    window.fetch = async () => { calls++; return Response.json({ tracks: { items: [] } }); };
    try {
      await primeManualSeedArtists('test', selected, 3, a); const manual = calls;
      await primeProfileGenres('test', selected, genrePrimeBudgetForTarget(total), a); const genres = calls - manual;
      await primeCommonGroupQueries('test', selected, Math.min(3, maxNewSearchesThisGeneration - calls), a);
      return { calls, count: newSearchesThisGeneration, budget: searchBudgetForTarget(total), manual, genres, common: calls - manual - genres };
    } finally { window.fetch = original; waitForSearchSlot = gap; }
  }, { total });
  assert.equal(result.count, result.calls); assert.ok(result.calls <= result.budget);
  assert.ok(result.manual <= 3 && result.genres <= (total === 60 ? 6 : total === 90 ? 7 : 8) && result.common <= 3);
  assert.equal(result.budget, total === 60 ? 12 : total === 90 ? 14 : 16);
});

test('wspólny etap wykorzystuje Last.fm dla nowego wykonawcy, nie dokłada strony nasyconego gatunku', async () => {
  const result = await evaluate(async ({ ids }) => {
    const selected = [{ id: 'bartek', genres: ['rock'], artists: [], categories: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    const make = n => ({ id: `a${n}`, uri: `spotify:track:a${n}`, name: `Song ${n}`, artists: [{ id: ids.A, name: 'A' }] });
    addLastFmArtists([{ name: 'A' }, { name: 'B' }], { tags: ['rock'] });
    saveCandidatePool([0, 1, 2].map(n => ({ track: make(n), queries: ['genre:"rock"'], savedAt: Date.now() })));
    const original = searchTracks, calls = [];
    searchTracks = async (_token, query) => { calls.push(query); newSearchesThisGeneration++; return []; };
    try { await primeCommonGroupQueries('test', selected, 1); return calls; } finally { searchTracks = original; }
  }, { ids });
  assert.deepEqual(result, ['artist:"B"']);
});

test('twarde blokady i silny feedback wykluczają zapytania nazwowe; blokada ID nie przenosi się na homonima', async () => {
  const result = await evaluate(async ({ ids }) => {
    const selected = [{ id: 'bartek', genres: [], artists: ['Blocked', 'Negative', 'Days of the New'], blockedArtists: ['Blocked'], categories: [], taste: {} }];
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ bad: { value: -1, artists: ['negative'] } }));
    setArtistExclusion({ id: 'wrong', name: 'Song', artists: [{ id: ids.A, name: 'Days of the New' }] }, ids.A, 'wrong_artist');
    const original = searchTracks, calls = [];
    searchTracks = async (_token, query) => { calls.push(query); newSearchesThisGeneration++; return []; };
    try { await primeManualSeedArtists('test', selected, 3); return calls; } finally { searchTracks = original; }
  }, { ids });
  assert.deepEqual(result, ['artist:"Days of the New"']);
});

test('429: ten sam limit retry, bez próby kolejnego źródła po błędzie i bez utraty stanu', async () => {
  const result = await evaluate(async () => {
    const selected = [{ id: 'bartek', genres: ['rock', 'jazz'], artists: [], categories: [], taste: {} }];
    const before = exportedStorageState(), originals = [fetch, sleep, waitForSearchSlot]; let calls = 0;
    window.fetch = async () => { calls++; return Response.json({ error: { message: 'Rate limited' } }, { status: 429, headers: { 'Retry-After': '1' } }); };
    sleep = async () => {}; waitForSearchSlot = async () => {};
    try {
      let error = ''; try { await primeProfileGenres('test', selected, 6); } catch (e) { error = e.message; }
      return { calls, searches: newSearchesThisGeneration, error, same: JSON.stringify(before) === JSON.stringify(exportedStorageState()) };
    } finally { [window.fetch, sleep, waitForSearchSlot] = originals; }
  });
  assert.equal(result.calls, 4); assert.equal(result.searches, 1); assert.match(result.error, /429/); assert.equal(result.same, true);
});

test('pełna ścieżka generowania: źródła, selekcja, kolejność, zapis i diagnostyka; świeże blokady sprawdzane po pozyskiwaniu', async () => {
  const result = await evaluate(async ({ ids }) => {
    const selected = [{ id: 'bartek', name: 'Bartek', genres: ['rock'], artists: [], manualGenres: [], blockedArtists: [], categories: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    const make = (artist, n) => ({ id: `${artist}${n}`, uri: `spotify:track:${artist}${n}`, name: `Song ${n}`, artists: [{ id: ids[artist], name: artist }], album: { name: 'Album' } });
    addLastFmArtists(['A', 'B', 'C'], { tags: ['rock'] });
    addLastFmTracks(['A', 'B', 'C'].flatMap(artist => [0, 1].map(n => ({ name: `Song ${n}`, artist: { name: artist } }))), { tags: ['rock'] });
    saveCandidatePool([0, 1].map(n => ({ track: make('A', n), queries: ['genre:"rock"'], savedAt: Date.now() })));
    const originals = [getValidAccessToken, cleanupOldOfficePlaylists, selectedProfiles, refreshLastFmBeforeGeneration, syncSpotifyRecentHistory, searchTracks, createPlaylist, addItemsToPlaylist, uploadCloudStateIfChanged];
    let written = [];
    getValidAccessToken = async () => 'test'; cleanupOldOfficePlaylists = async () => ({ found: 0, removed: 0, remaining: 0 });
    selectedProfiles = () => selected; refreshLastFmBeforeGeneration = async () => {}; syncSpotifyRecentHistory = async () => {};
    searchTracks = async (_token, query) => {
      newSearchesThisGeneration++;
      const tracks = [make('B', 0), make('B', 1), make('C', 0), make('C', 1)]; addToCandidatePool(query, tracks);
      // Simulate a concurrent explicit name block while the API is in flight.
      localStorage.setItem(FEEDBACK_BLOCKED_ARTISTS_KEY, JSON.stringify({ b: { name: 'B' } }));
      return tracks;
    };
    createPlaylist = async () => ({ id: 'test', name: 'Test', uri: 'spotify:playlist:test', external_urls: { spotify: 'https://open.spotify.com/playlist/test' } });
    addItemsToPlaylist = async (_token, _id, uris) => { written = uris; };
    uploadCloudStateIfChanged = async () => ({ saved: 0 });
    try {
      await generateOfficePlaylist();
      return { written, snapshot: loadRecentPlaylists()[0]?.tracks.map(t => t.id), text: playlistResult.textContent, disabled: generateButton.disabled };
    } finally { [getValidAccessToken, cleanupOldOfficePlaylists, selectedProfiles, refreshLastFmBeforeGeneration, syncSpotifyRecentHistory, searchTracks, createPlaylist, addItemsToPlaylist, uploadCloudStateIfChanged] = originals; }
  }, { ids });
  assert.equal(result.written.length, 4); assert.ok(result.written.every(uri => !uri.includes(':B')));
  assert.equal(result.snapshot.length, 4); assert.match(result.text, /Pozyskiwanie: kwalifikowalni wykonawcy/); assert.match(result.text, /v43.22.P2/); assert.equal(result.disabled, false);
});

test('istniejące blokady historii, duplikaty i wersje nie są liczone jako kwalifikowalna różnorodność', async () => {
  const result = await evaluate(({ ids }) => {
    const selected = [{ id: 'bartek', genres: ['rock'], artists: [], categories: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    const make = (id, artist, title) => ({ id, uri: `spotify:track:${id}`, name: title, artists: [{ id: ids[artist], name: artist }] });
    addLastFmArtists(['A', 'B', 'C'], { tags: ['rock'] });
    const tracks = [make('a1', 'A', 'Song'), make('a2', 'A', 'Song - 2025 Remaster'), make('b1', 'B', 'Song'), make('c1', 'C', 'Song - Rework')];
    saveCandidatePool(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: Date.now() })));
    const blocks = generationBlocklists(selected); blocks.blockedArtists.add(ids.B);
    const c = acquisitionCoverage(selected, blocks);
    return { artists: c.artists, signatures: c.byArtist.get('a').size, capacity: c.queryCapacity.get(canonicalQuery('genre:"rock"')) };
  }, { ids });
  assert.deepEqual(result, { artists: 1, signatures: 1, capacity: 1 });
});

test('pełna pula 2000: cache wariantów i wielu utworów jednego artysty nie wypiera dotychczas kwalifikowalnych', async () => {
  const result = await evaluate(async ({ ids }) => {
    const selected = [{ id: 'bartek', genres: ['rock'], artists: [], categories: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    const make = (artist, n, variant = false) => ({ id: `${artist}-${n}`, uri: `spotify:track:${artist}-${n}`, name: `Song ${n}${variant ? ' - Rework' : ''}`, artists: [{ id: ids[artist], name: artist }] });
    addLastFmArtists(['A', 'B', 'C'], { tags: ['rock'] });
    saveCandidatePool([make('A', 0), make('A', 1), ...Array.from({ length: 1998 }, (_, i) => make('C', i, true))].map(track => ({ track, queries: ['genre:"rock"'], savedAt: Date.now() })));
    for (let offset = 0; offset < 100; offset += 10) writeSearchCache('genre:"rock"', offset, Array.from({ length: 10 }, (_, i) => make('B', offset + i)));
    const a = createCandidateAcquisition(selected), start = performance.now();
    await primeDiverseQueries('test', [{ query: 'genre:"rock"' }], 0, a);
    const c = acquisitionCoverage(selected, a.blocklists), pool = loadCandidatePool();
    return { size: pool.length, artists: c.artists, protected: ['A-0', 'A-1'].every(id => pool.some(row => row.track.id === id)), cachedB: pool.filter(row => row.track.artists[0].name === 'B').length, searches: newSearchesThisGeneration, elapsedMs: Math.round(performance.now() - start) };
  }, { ids });
  assert.equal(result.size, 2000); assert.equal(result.artists, 2); assert.equal(result.protected, true); assert.equal(result.cachedB, 2); assert.equal(result.searches, 0);
});

test('quota przy reuse cache zachowuje pulę i preferencje', async () => {
  const result = await evaluate(async ({ ids }) => {
    const selected = [{ id: 'bartek', genres: ['rock'], artists: [], categories: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    const track = { id: 'new', uri: 'spotify:track:new', name: 'Song', artists: [{ id: ids.B, name: 'B' }] };
    addLastFmArtists(['B'], { tags: ['rock'] }); writeSearchCache('genre:"rock"', 10, [track]);
    localStorage.setItem('office_seed_bartek', 'B');
    const before = exportedStorageState(), original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v) { if (k === CANDIDATE_POOL_KEY) throw new DOMException('Quota', 'QuotaExceededError'); return original.call(this, k, v); };
    try { await primeDiverseQueries('test', [{ query: 'genre:"rock"' }], 0, createCandidateAcquisition(selected)); return JSON.stringify(before) === JSON.stringify(exportedStorageState()); }
    finally { Storage.prototype.setItem = original; }
  }, { ids });
  assert.equal(result, true);
});
test('D po D.2: nowy kandydat cache zachowuje czas pozyskania, bez API i odnawiania TTL', async () => {
  const r = await evaluate(async () => {
    const now = Date.now(), acquiredAt = now - 10000, track = { id: 'cache-new', uri: 'spotify:track:cache-new', name: 'Song', artists: [{ id: '1111111111111111111111', name: 'Good' }] };
    addLastFmArtists(['Good'], { tags: ['rock'] });
    localStorage.setItem(searchCacheKey('genre:"rock"', 0), JSON.stringify({ savedAt: acquiredAt, items: [track] }));
    const selected = [{ id: 'bartek', genres: ['rock'], artists: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    await primeDiverseQueries('test', [{ query: 'genre:"rock"' }], 0, createCandidateAcquisition(selected));
    const row = loadCandidatePool()[0]; return { age: row.savedAt === acquiredAt, used: row.lastUsedAt >= now, calls: newSearchesThisGeneration };
  });
  assert.deepEqual(r, { age: true, used: true, calls: 0 });
});
test('D po D.2: cache nie przycina przedstawiciela nieobecnego profilu przed wspólną retencją', async () => {
  const r = await evaluate(async () => {
    localStorage.setItem('office_genres_monika', 'classical');
    const now = Date.now(), row = (id, artist, title, at) => ({ track: { id, uri: `spotify:track:${id}`, name: title, artists: [{ id: artist.padEnd(22, '0'), name: artist }] }, queries: ['genre:"rock"'], savedAt: at });
    addLastFmArtists(['Rare'], { tags: ['classical'] }); addLastFmArtists(['Good'], { tags: ['rock'] });
    localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify([...Array.from({ length: 1999 }, (_, i) => row(`bad${i}`, 'Bad', `Bad ${i} - Rework`, now - 1000)), row('rare', 'Rare', 'Rare song', now - 2000)]));
    writeSearchCache('genre:"rock"', 0, [row('new1', 'Good', 'Good one', now).track, row('new2', 'Good', 'Good two', now).track]);
    const selected = [{ id: 'bartek', genres: ['rock'], artists: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    await primeDiverseQueries('test', [{ query: 'genre:"rock"' }], 0, createCandidateAcquisition(selected));
    const rows = loadCandidatePool(); return { size: rows.length, rare: rows.some(r => r.track.id === 'rare'), added: rows.filter(r => r.track.id.startsWith('new')).length, calls: newSearchesThisGeneration };
  });
  assert.deepEqual(r, { size: 2000, rare: true, added: 2, calls: 0 });
});
test('D po D.2: pełna pula kwalifikowalnych utworów jednego artysty nie blokuje różnorodności z cache', async () => {
  const r = await evaluate(async () => {
    const now = Date.now(), track = (id, artist) => ({ id, uri: `spotify:track:${id}`, name: `Song ${id}`, artists: [{ id: artist.padEnd(22, '0'), name: artist }] });
    addLastFmArtists(['Old', 'New'], { tags: ['rock'] });
    localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ track: track(`old${i}`, 'Old'), queries: ['genre:"rock"'], savedAt: now - 1000 }))));
    writeSearchCache('genre:"rock"', 0, [track('new1', 'New'), track('new2', 'New')]);
    const selected = [{ id: 'bartek', genres: ['rock'], artists: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    const a = createCandidateAcquisition(selected); await primeDiverseQueries('test', [{ query: 'genre:"rock"' }], 0, a);
    const pool = loadCandidatePool(); return { size: pool.length, artists: acquisitionCoverage(selected, a.blocklists).artists, added: pool.filter(r => r.track.artists[0].name === 'New').length, calls: newSearchesThisGeneration };
  });
  assert.deepEqual(r, { size: 2000, artists: 2, added: 2, calls: 0 });
});
test('snapshot pozyskiwania zachowuje filtry i oceny, także przy duplikatach legacy', async () => {
  const r = await evaluate(() => {
    const now = Date.now(), selected = [{ id: 'bartek', genres: ['rock'], artists: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([{ artist: 'Artist', tags: ['classical'], savedAt: now }, { artist: 'Artist', tags: ['rock'], savedAt: now }]));
    const tracks = ['Song', 'Song - Rework', 'Symphony No. 5 (Orchestra)', 'Other - 2025 Remaster'].map((name, i) => ({ id: String(i), uri: `spotify:track:${i}`, name, artists: [{ name: 'Artist' }] }));
    saveCandidatePool(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now })));
    const blocks = generationBlocklists(selected);
    const a = eligibleGroupCandidates(selected, blocks, buildGroupRecommendationContext(selected));
    const b = eligibleGroupCandidates(selected, blocks, acquisitionContext(selected));
    const summary = result => ({ stats: result.stats, rows: result.eligible.map(r => ({ id: r.track.id, base: r.groupBase, byUser: r.byUser })) });
    return { a: summary(a), b: summary(b) };
  });
  assert.deepEqual(r.a, r.b);
});
