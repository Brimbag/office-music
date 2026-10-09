import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { startBrowserHarness } from './helpers/browser.mjs';
const context = createContext({});
new Script(readFileSync(new URL('../artist-catalog-evidence.js', import.meta.url), 'utf8')).runInContext(context);
const api = context.OfficeArtistCatalogEvidence;
const A = '1111111111111111111111', B = '2222222222222222222222', C = '3333333333333333333333';
const M = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', N = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const name = 'Days of the New', album = 'Days of the New';
const titles = ['Touch, Peel and Stand', 'Shelf in the Room'];
const sf = (id, title, release = album, performer = name) => ({ id: `${id}-${title}`, name: title, album: { name: release }, artists: [{ id, name: performer }] });
const lf = (title, release = album, performer = name, artistMbid = M) => ({ artist: performer, track: title, catalogEvidence: [{ artistName: performer, trackName: title, album: release, artistMbid, trackMbid: '' }] });
const base = () => ({ spotifyTracks: [...titles.map(t => sf(A, t)), sf(B, 'Unknown Single', 'Unknown Album')], lastfmTracks: titles.map(t => lf(t)) });
const report = input => JSON.parse(JSON.stringify(api.analyze(input)));
const only = input => report(input).rows[0];

// Fixtures exercise counterexamples, not popularity-based approximations of identity.
test('dwa Spotify ID Days of the New: dwa utwory z albumami wskazują tylko właściwy katalog', () => {
  const input = base(), before = JSON.stringify(input), r = report(input), row = r.rows[0];
  assert.equal(row.status, 'supported'); assert.equal(row.suggestedId, A);
  assert.deepEqual(row.catalogs.map(c => [c.id, c.matchedTitles, c.albumMatchedTitles]), [[A, 2, 2], [B, 0, 0]]);
  assert.equal(r.summary.proposals, 1); assert.equal(r.summary.multiIdNames, 1); assert.equal(r.summary.coverage, 1);
  assert.equal(r.summary.verifiedFalseMatchRate, null); assert.equal(JSON.stringify(input), before);
});

test('nazwa, tag, popularność i pojedynczy tytuł z albumem nie wystarczają', () => {
  const row = only({ spotifyTracks: [sf(B, 'Other')], lastfmArtists: [{ artist: name, tags: ['rock'], recentCount: 1000 }], lastfmTracks: [] });
  assert.equal(row.status, 'name_only'); assert.equal(row.suggestedId, null);
  for (const count of [1, 2]) {
    const input = base(); input.spotifyTracks = titles.slice(0, count).map(t => ({ ...sf(A, t), popularity: 100 }));
    if (count === 2) input.lastfmTracks = titles.map(t => ({ artist: name, track: t }));
    assert.equal(only(input).status, 'insufficient'); assert.equal(only(input).suggestedId, null);
  }
});

test('drugi homonim z choć jednym zgodnym utworem daje nierozstrzygnięcie, bez wyboru zwycięzcy rankingu', () => {
  const input = base(); input.spotifyTracks.push(sf(B, titles[0]));
  assert.equal(only(input).status, 'ambiguous'); assert.equal(only(input).suggestedId, null);
});

test('powtórne scrobble, kopie cache i różne wydania jednego tytułu nie udają dwóch utworów', () => {
  const input = { spotifyTracks: [sf(A, titles[0]), sf(A, titles[0], 'Other'), sf(A, titles[0])], lastfmTracks: [lf(titles[0]), lf(titles[0]), lf(titles[0], 'Other')] };
  const row = only(input);
  assert.equal(row.catalogs[0].matchedTitles, 1); assert.equal(row.catalogs[0].albumMatchedTitles, 1); assert.equal(row.status, 'insufficient');
});

test('sprzeczne MBID Last.fm i obcięte dowody blokują propozycję', () => {
  for (const type of ['mbids', 'truncated']) {
    const input = base();
    if (type === 'mbids') input.lastfmTracks[1].catalogEvidence[0].artistMbid = N;
    else input.lastfmTracks[0].catalogEvidenceTruncated = true;
    assert.equal(only(input).status, 'lastfm_ambiguous'); assert.equal(only(input).suggestedId, null);
  }
});

test('zgłoszony niewłaściwy ID jest sprzecznością, a nie automatycznie odblokowaną propozycją', () => {
  const input = base(); input.wrongArtistIds = [A];
  const r = report(input);
  assert.equal(r.rows[0].status, 'negative_conflict'); assert.equal(r.rows[0].suggestedId, null);
  assert.equal(r.summary.negativeContradictions, 1); assert.equal(r.summary.proposals, 0);
  assert.equal(r.summary.verifiedFalseMatchRate, null);
});

test('nawet po odrzuceniu jednego ID zgodność dwóch katalogów pozostaje niejednoznaczna', () => {
  const input = base(); input.spotifyTracks.push(sf(B, titles[0])); input.wrongArtistIds = [B];
  assert.equal(only(input).status, 'ambiguous'); assert.equal(only(input).suggestedId, null);
});

test('utwory współwykonawców i niepełne ID nie dostarczają dowodu solo', () => {
  for (const partner of [{ id: C, name: 'Partner' }, { id: '', name: 'Partner' }]) {
    const input = base(); input.spotifyTracks = titles.map(t => ({ ...sf(A, t), artists: [{ id: A, name }, partner] }));
    const row = report(input).rows.find(r => r.name === name);
    assert.equal(row.status, 'collaboration_only'); assert.equal(row.suggestedId, null); assert.equal(row.catalogs[0].matchedTitles, 0);
  }
  const input = base(); input.spotifyTracks = titles.map(t => sf('invalid', t));
  assert.equal(only(input).status, 'missing_spotify');
});

test('nie usuwamy akcentów, znaków tytułu, Rework, live ani oznaczeń orkiestrowych', () => {
  for (const title of ['Touch Peel and Stand', 'Touch, Peel and Stand - Rework', 'Touch, Peel and Stand (Live)', 'Touch, Peel and Stand (Orchestral Version)']) {
    const input = base(); input.spotifyTracks[0].name = title;
    assert.equal(only(input).status, 'insufficient');
  }
  const r = report({ spotifyTracks: [sf(A, 'Song', 'Album', 'Beyonce')], lastfmTracks: [lf('Song', 'Album', 'Beyoncé')] });
  assert.equal(r.summary.proposals, 0); assert.equal(r.rows.length, 2);
});

test('oryginalny tytuł i wykonawca dowodu muszą pasować mimo starych stratnych kluczy cache', () => {
  for (const field of ['artistName', 'trackName']) {
    const input = base(); input.lastfmTracks[0].catalogEvidence[0][field] = 'Inny';
    assert.equal(only(input).status, 'insufficient');
  }
  const input = base(); input.lastfmTracks = input.lastfmTracks.map(r => ({ ...r, catalogEvidence: r.catalogEvidence.map(({ artistName, trackName, ...e }) => e) }));
  assert.equal(only(input).status, 'insufficient');
});

test('normalizacja NFKC, wielkości liter i odstępów jest bezpieczna, raport nie zależy od kolejności', () => {
  const input = base(); input.spotifyTracks[0].name = '  TOUCH,  PEEL AND STAND  '; input.spotifyTracks[0].artists[0].name = 'DAYS OF THE NEW';
  const a = report(input), b = report({ ...input, spotifyTracks: [...input.spotifyTracks].reverse(), lastfmTracks: [...input.lastfmTracks].reverse() });
  // Display spelling can reflect the first row, while all decisions and counts remain stable.
  assert.equal(a.rows[0].status, 'supported'); assert.deepEqual(a, b);
});

test('cold start i katalog wyłącznie Spotify: zero propozycji i brak dzielenia przez zero', () => {
  const empty = report({}); assert.equal(empty.summary.coverage, 0); assert.deepEqual(empty.rows, []);
  const r = report({ spotifyTracks: [sf(A, 'Song')] }); assert.equal(r.rows[0].status, 'missing_lastfm'); assert.equal(r.summary.coverage, 0);
});

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(run, arg) {
  const session = await harness.page();
  try { const result = await session.page.evaluate(run, arg); assert.deepEqual(session.errors, []); return result; }
  finally { await session.close(); }
}

test('cache Last.fm zachowuje album i MBID, a stary cache nie zmyśla brakujących danych', async () => {
  const result = await evaluate(({ M }) => {
    const raw = { name: 'Song', artist: { '#text': 'Artist', mbid: M }, album: { '#text': 'Album' }, mbid: M, date: { uts: '123' } };
    const compact = compactLastFmCacheData('user.getRecentTracks', { recenttracks: { track: [raw] } }).recenttracks.track[0];
    const top = compactLastFmCacheData('tag.getTopTracks', { tracks: { track: [raw] } }).tracks.track[0];
    const old = compactLastFmCacheData('tag.getTopTracks', { tracks: { track: [{ name: 'Song', artist: { name: 'Artist' } }] } }).tracks.track[0];
    return { album: compact.album, artistMbid: compact.artist.mbid, trackMbid: compact.mbid, date: compact.date, topAlbum: top.album, oldAlbum: old.album ?? null };
  }, { M });
  assert.deepEqual(result, { album: { '#text': 'Album' }, artistMbid: M, trackMbid: M, date: { uts: '123' }, topAlbum: { '#text': 'Album' }, oldAlbum: null });
});

test('odświeżenie danych nie usuwa albumów, tagów i MBID, a dowody mają ograniczoną liczbę', async () => {
  const result = await evaluate(({ M, N }) => {
    const item = album => ({ name: 'Song', artist: { name: 'Artist', mbid: M }, album: { '#text': album }, mbid: N });
    addLastFmTracks([item('Album')], { tags: ['rock'] });
    addLastFmTracks([{ name: 'Song', artist: { name: 'Artist' } }], { source: 'recent' });
    const first = loadLastFmTrackPool()[0];
    addLastFmTracks(['B', 'C', 'D', 'E'].map(item));
    const last = loadLastFmTrackPool()[0];
    addLastFmArtists([{ name: 'Artist', mbid: M }], { tags: ['rock'] });
    addLastFmArtists(['Artist'], { source: 'recent' });
    return { first, count: last.catalogEvidence.length, truncated: last.catalogEvidenceTruncated, artist: loadLastFmArtistPool()[0] };
  }, { M, N });
  assert.equal(result.first.catalogEvidence[0].album, 'Album'); assert.equal(result.first.catalogEvidence[0].artistMbid, M);
  assert.deepEqual(result.first.tags, ['rock']); assert.deepEqual(result.first.sources, ['tag', 'recent']);
  assert.equal(result.count, 4); assert.equal(result.truncated, true); assert.deepEqual(result.artist.catalogMbids, [M]);
  assert.deepEqual(result.artist.tags, ['rock']);
});

test('diagnostyka i dialog pokazują propozycję bez zapisywania powiązań, ocen lub nowych blokad', async () => {
  const result = await evaluate(({ A, B, titles, M }) => {
    const name = 'Days of the New', make = (id, title) => ({ id: `${id}-${title}`, uri: `spotify:track:${id}-${title}`, name: title, artists: [{ id, name }], album: { name } });
    const good = titles.map(t => make(A, t)), bad = make(B, 'Unknown');
    saveCandidatePool([...good, bad].map(track => ({ track, queries: [], savedAt: Date.now() })));
    addLastFmTracks(titles.map(t => ({ name: t, artist: { name, mbid: M }, album: { '#text': name } })), { tags: ['rock'] });
    localStorage.setItem('office_artist_identity_v2', 'opaque archive');
    setArtistExclusion(bad, B, 'wrong_artist');
    const before = exportedStorageState();
    let requests = 0; const original = fetch;
    window.fetch = () => { requests++; throw new Error('Offline'); };
    try {
      renderArtistCatalogEvidence(); openArtistExclusionDialog(bad);
      return { summary: document.getElementById('catalogEvidenceSummary').textContent, dialog: document.getElementById('artistExclusionCandidates').textContent, row: localArtistCatalogEvidence().rows[0], unchanged: JSON.stringify(before) === JSON.stringify(exportedStorageState()), requests, states: [A, B].map(id => artistExclusionStatus(id).blocked), feedback: loadFeedback(), archive: localStorage.getItem('office_artist_identity_v2') };
    } finally { window.fetch = original; }
  }, { A, B, titles, M });
  assert.match(result.summary, /Propozycje z repertuaru i albumów: 1\/1/); assert.match(result.summary, /Trafność nie została zweryfikowana/);
  assert.match(result.dialog, /propozycja wymaga sprawdzenia/); assert.match(result.dialog, /Touch, Peel and Stand/);
  assert.equal(result.row.suggestedId, A); assert.equal(result.unchanged, true); assert.equal(result.requests, 0);
  assert.deepEqual(result.states, [false, true]); assert.deepEqual(result.feedback, {}); assert.equal(result.archive, 'opaque archive');
});

for (const people of [2, 4]) test(`${people} profile: diagnostyka i nowe metadane nie zmieniają długości ani jakości playlist`, async t => {
  const result = await evaluate(({ people, A, M }) => {
    const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }));
    const tracks = Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ id: i < 2 ? A : String(Math.floor(i / 2) + 2).repeat(22), name: `Artist ${Math.floor(i / 2)}` }], album: { name: 'Album' } }));
    const now = Date.now();
    saveCandidatePool(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now })));
    addLastFmTracks(tracks.map(t => ({ name: t.name, artist: { name: t.artists[0].name } })), { tags: ['rock'] });
    const generate = () => {
      Math.random = () => 0.25;
      const ctx = buildGroupRecommendationContext(selected), empty = () => new Set();
      const lists = { blockedTracks: empty(), blockedTrackSignatures: empty(), blockedArtists: empty(), historyBlockedNames: empty(), explicitBlockedNames: empty(), feedbackBlockedNames: empty() };
      const { eligible, stats } = eligibleGroupCandidates(selected, lists, ctx), output = selectGroupPlaylist(eligible, 12, ctx, stats);
      return { ids: output.tracks.map(t => t.id), satisfaction: output.satisfaction, rejectionStats: output.rejectionStats, details: [...output.details].map(([id, d]) => [id, d.byUser]) };
    };
    const before = generate();
    addLastFmTracks(tracks.map(t => ({ name: t.name, artist: { name: t.artists[0].name, mbid: M }, album: { '#text': 'Album' } })), { tags: ['rock'] });
    const stored = exportedStorageState(); renderArtistCatalogEvidence(); const after = generate();
    return { before, after, noDiagnosticWrites: JSON.stringify(stored) === JSON.stringify(exportedStorageState()), proposals: localArtistCatalogEvidence().summary.proposals, searches: searchBudgetForTarget(60), lastfmBudget: lastFmTagBudgetForTarget(60) };
  }, { people, A, M });
  assert.deepEqual(result.after, result.before); assert.equal(result.after.ids.length, 12); assert.equal(result.noDiagnosticWrites, true);
  assert.equal(result.proposals, 8); assert.equal(result.searches, 12);
  t.diagnostic(JSON.stringify({ people, before: result.before.ids.length, after: result.after.ids.length, satisfaction: result.after.satisfaction, lastfmBudget: result.lastfmBudget }));
});

test('dowody nie scalają długich albumów przez obcięcie wspólnego prefiksu, nieprawidłowy MBID jest pomijany', () => {
  const prefix = 'X'.repeat(300);
  const e = api.metadata({ name: 'Song', artist: { name: 'Artist', mbid: 'invalid' }, album: { '#text': `${prefix} A` }, mbid: 'invalid' });
  assert.equal(e.album, ''); assert.equal(e.artistMbid, ''); assert.equal(e.trackMbid, '');
});

test('stronicowane scrobble i ich cache zachowują dowody przy niezmienionej liczbie wywołań Last.fm', async () => {
  const result = await evaluate(async ({ M, titles }) => {
    lastFmUserInput.value = 'test-user';
    const original = lastFmRequest, calls = [];
    lastFmRequest = async (method, params) => {
      calls.push({ method, page: params.page });
      return { recenttracks: { '@attr': { totalPages: '2' }, track: [{ name: titles[params.page - 1], artist: { '#text': 'Days of the New', mbid: M }, album: { '#text': 'Days of the New' }, date: { uts: String(Math.floor(Date.now() / 1000) - params.page) } }] } };
    };
    try {
      await syncLastFmSources([], { includeTags: false, includeRecent: true });
      return { calls, tracks: loadLastFmTrackPool(), history: loadHistory().map(row => ({ artistIds: row.artistIds, source: row.source })), candidateSearches: newSearchesThisGeneration };
    } finally { lastFmRequest = original; }
  }, { M, titles });
  assert.deepEqual(result.calls, [{ method: 'user.getRecentTracks', page: 1 }, { method: 'user.getRecentTracks', page: 2 }]);
  assert.equal(result.tracks.length, 2); assert.ok(result.tracks.every(row => row.catalogEvidence[0].album === album && row.catalogEvidence[0].artistMbid === M));
  assert.deepEqual(result.history, [{ artistIds: [], source: 'lastfm' }, { artistIds: [], source: 'lastfm' }]);
  assert.equal(result.candidateSearches, 0);
});

test('quota przy zapisie rozszerzonej puli Last.fm zachowuje poprzedni stan i preferencje', async () => {
  const result = await evaluate(({ M }) => {
    addLastFmTracks([{ name: 'Song', artist: { name: 'Artist' } }], { tags: ['rock'] });
    localStorage.setItem('office_seed_bartek', 'Artist');
    const before = exportedStorageState(), original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v) {
      if (k === LASTFM_TRACK_POOL_KEY) throw new DOMException('Quota', 'QuotaExceededError');
      return original.call(this, k, v);
    };
    try {
      addLastFmTracks([{ name: 'Song', artist: { name: 'Artist', mbid: M }, album: { '#text': 'Album' } }]);
      renderArtistCatalogEvidence();
      return { unchanged: JSON.stringify(before) === JSON.stringify(exportedStorageState()), proposals: localArtistCatalogEvidence().summary.proposals };
    } finally { Storage.prototype.setItem = original; }
  }, { M });
  assert.deepEqual(result, { unchanged: true, proposals: 0 });
});

test('prawdziwy przycisk diagnostyki działa przy cold start; nazwy i tytuły są zwykłym tekstem', async () => {
  const session = await harness.page();
  try {
    await session.page.evaluate(({ A }) => {
      const track = { id: 'test', uri: 'spotify:track:test', name: '<script>window.injection=true</script>', artists: [{ id: A, name: '<img src=x onerror="window.injection=true">' }] };
      saveCandidatePool([{ track, queries: [], savedAt: Date.now() }]);
      document.getElementById('mixerBox').style.display = 'block';
    }, { A });
    await session.page.getByText('Porównanie wykonawców Spotify–Last.fm', { exact: true }).click();
    await session.page.getByRole('button', { name: 'Porównaj lokalną bazę', exact: true }).click();
    assert.match(await session.page.locator('#catalogEvidenceSummary').textContent(), /Last.fm: 0 nazw/);
    assert.match(await session.page.locator('#catalogEvidenceRows').textContent(), /<img src=x/);
    assert.equal(await session.page.evaluate(() => Boolean(window.injection)), false);
    assert.equal(await session.page.locator('#catalogEvidenceRows img').count(), 0);
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test('dwa tytuły tego samego nagrania MBID nie udają dwóch niezależnych utworów', () => {
  const input = base();
  for (const track of input.lastfmTracks) track.catalogEvidence[0].trackMbid = N;
  assert.equal(only(input).status, 'lastfm_ambiguous'); assert.equal(only(input).suggestedId, null);
});

test('duża baza: podsumowanie obejmuje wszystkie katalogi, filtr odnajduje Days of the New poza pierwszymi 100 wynikami', async () => {
  const session = await harness.page();
  try {
    await session.page.evaluate(({ A }) => {
      const names = [...Array.from({ length: 110 }, (_, i) => `Artist ${i}`), 'Days of the New'];
      saveCandidatePool(names.map((name, i) => ({ track: { id: `t${i}`, uri: `spotify:track:t${i}`, name: 'Song', artists: [{ id: i === 110 ? A : String(i).padStart(22, '0'), name }] }, queries: [], savedAt: Date.now() })));
      document.getElementById('mixerBox').style.display = 'block';
    }, { A });
    await session.page.getByText('Porównanie wykonawców Spotify–Last.fm', { exact: true }).click();
    await session.page.getByRole('button', { name: 'Porównaj lokalną bazę', exact: true }).click();
    assert.equal(await session.page.locator('#catalogEvidenceRows > details').count(), 100);
    assert.match(await session.page.locator('#catalogEvidenceSummary').textContent(), /Spotify: 111 katalogów/);
    await session.page.locator('#catalogEvidenceFilter').fill('Days of the New');
    assert.equal(await session.page.locator('#catalogEvidenceRows > details').count(), 1);
    assert.match(await session.page.locator('#catalogEvidenceRows').textContent(), /Days of the New/);
    assert.match(await session.page.locator('#catalogEvidenceSummary').textContent(), /Spotify: 111 katalogów/);
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});
