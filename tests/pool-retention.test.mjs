import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
await import('../pool-retention.js');
const policy = globalThis.OfficePoolRetention;
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness.close(); });
async function evaluate(fn, arg) {
  const s = await harness.page();
  try { const r = await s.page.evaluate(fn, arg); assert.deepEqual(s.errors, []); return r; }
  finally { await s.close(); }
}
test('retencja: priorytet wartościowych, pokrycie mniejszości i brak twardego limitu dwóch w bazie', () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ row: i, key: String(i), artist: 'Common', savedAt: 100, protected: true, coverage: ['rock'] }));
  entries.push({ row: 99, key: 'minority', artist: 'Minority', savedAt: 1, protected: true, coverage: ['classical', 'absent'] });
  entries.push({ row: 100, key: 'bad', artist: 'Bad', savedAt: 1000, protected: false });
  const r = policy.retain(entries, 6);
  assert.equal(r.length, 6); assert.ok(r.includes(99)); assert.ok(!r.includes(100)); assert.equal(r.filter(i => i < 10).length, 5);
});
for (const cap of [2000, 3000]) test(`stały limit ${cap}: flood 20 nagrań jednego wykonawcy nie wypiera 19 różnych`, () => {
  const old = Array.from({ length: cap }, (_, i) => ({ row: { artist: `Artist ${i}`, key: `old${i}` }, key: `old${i}`, artist: `Artist ${i}`, savedAt: 1 }));
  const incoming = Array.from({ length: 20 }, (_, i) => ({ row: { artist: 'New', key: `new${i}` }, key: `new${i}`, artist: 'New', savedAt: 2 }));
  const result = policy.retain([...old, ...incoming], cap);
  assert.equal(result.length, cap); assert.equal(new Set(result.map(r => r.artist)).size, cap);
});
test('rotacja nierównych grup wypełnia limit bez duplikatów i nie premiuje rozmiaru katalogu', () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ row: `A${i}`, key: `A${i}`, artist: 'A' })); entries.push({ row: 'B', key: 'B', artist: 'B' });
  const result = policy.rotate(entries, 30); assert.equal(result.rows.length, 30); assert.equal(new Set(result.rows).size, 30); assert.equal(result.rows[1], 'B');
  assert.equal(policy.rotate([], 30).rows.length, 0); assert.equal(policy.rotate(entries, 0).rows.length, 0);
});
test('Spotify: świeże API i cloud merge zachowują kwalifikowalny rekord przed odrzucanym Rework', async () => {
  const r = await evaluate(() => {
    const now = Date.now(), row = (id, name, artist, savedAt) => ({ track: { id, uri: `spotify:track:${id}`, name, artists: [{ id: artist === 'Good' ? '1111111111111111111111' : '2222222222222222222222', name: artist }] }, queries: ['genre:"rock"'], savedAt });
    addLastFmArtists(['Good'], { tags: ['rock'] });
    const old = [row('good', 'Song', 'Good', now - 2000), ...Array.from({ length: 1999 }, (_, i) => row(`bad${i}`, `Song ${i} - Rework`, 'Bad', now - 1000))];
    localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(old));
    const incoming = row('new', 'New - Rework', 'Bad', now);
    addToCandidatePool('genre:"rock"', [incoming.track]);
    const api = loadCandidatePool(); const cloud = mergedCandidatePool(old, [incoming]);
    return { apiLength: api.length, apiGood: api.some(r => r.track.id === 'good'), cloudLength: cloud.length, cloudGood: cloud.some(r => r.track.id === 'good') };
  });
  assert.deepEqual(r, { apiLength: 2000, apiGood: true, cloudLength: 2000, cloudGood: true });
});
test('cloud merge ma deterministyczny wynik przy odwróceniu stron i równych timestampach', async () => {
  const r = await evaluate(() => {
    const now = Date.now();
    const row = (id, name) => ({ track: { id, uri: `spotify:track:${id}`, name, artists: [{ id: '1111111111111111111111', name: 'Artist' }] }, queries: ['genre:"rock"'], savedAt: now });
    const left = Array.from({ length: 2000 }, (_, i) => row(String(i), 'Song')), right = [row('0', 'Other'), row('new', 'New')];
    return { first: mergedCandidatePool(left, right), second: mergedCandidatePool(right, left) };
  });
  assert.deepEqual(r.first, r.second);
});
test('cache Spotify nie odnawia savedAt i nie przedłuża TTL', async () => {
  const r = await evaluate(async () => {
    const now = Date.now(), track = { id: 'cached', uri: 'spotify:track:cached', name: 'Song', artists: [{ name: 'Artist' }] };
    localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify([{ track, queries: ['genre:"rock"'], savedAt: now - 29 * 86400000 }]));
    writeSearchCache('genre:"rock"', 0, [track]);
    await searchTracks('mock', 'genre:"rock"', 0);
    const row = loadCandidatePool()[0];
    return { acquired: row.savedAt === now - 29 * 86400000, used: row.lastUsedAt >= now, api: newSearchesThisGeneration };
  });
  assert.deepEqual(r, { acquired: true, used: true, api: 0 });
});
test('Last.fm: tagowy cache nie odnawia czasu pozyskania wykonawcy ani utworu', async () => {
  const r = await evaluate(() => {
    const now = Date.now(), old = now - 44 * 86400000;
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([{ artist: 'Artist', tags: ['rock'], savedAt: old }]));
    localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify([{ artist: 'Artist', track: 'Song', tags: ['rock'], savedAt: old }]));
    addLastFmArtists(['Artist'], { tags: ['rock'], acquiredAt: old - 1000 });
    addLastFmTracks([{ name: 'Song', artist: { name: 'Artist' } }], { tags: ['rock'], acquiredAt: old - 1000 });
    return { artist: loadLastFmArtistPool()[0].savedAt, track: loadLastFmTrackPool()[0].savedAt, expected: old };
  });
  assert.equal(r.artist, r.expected); assert.equal(r.track, r.expected);
});
test('pełna pula Last.fm: nowi wykonawcy przechodzą mimo wysokich liczników legacy', async () => {
  const r = await evaluate(() => {
    const now = Date.now();
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(Array.from({ length: 1800 }, (_, i) => ({ artist: `Old ${i}`, tags: ['rock'], recentCount: 99, savedAt: now - 1000 }))));
    addLastFmArtists(Array.from({ length: 20 }, (_, i) => `New ${i}`), { tags: ['rock'] });
    const pool = loadLastFmArtistPool(); return { size: pool.length, added: pool.filter(r => r.artist.startsWith('New')).length, removed: 1800 - pool.filter(r => r.artist.startsWith('Old')).length };
  });
  assert.deepEqual(r, { size: 1800, added: 20, removed: 20 });
});
test('1800 wykonawców Last.fm otrzymuje propozycję w 100 turach, zamiast head 54', async () => {
  const r = await evaluate(() => {
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(Array.from({ length: 1800 }, (_, i) => ({ artist: `Artist ${i}`, tags: ['rock'], savedAt: Date.now() }))));
    const names = new Set(); for (let i = 0; i < 100; i++) lastFmArtistsForTags(['rock'], 18).forEach(name => names.add(name));
    return { count: names.size, stateKeys: Object.keys(JSON.parse(localStorage.getItem('office_lastfm_source_rotation_v1'))).length };
  });
  assert.deepEqual(r, { count: 1800, stateKeys: 1 });
});
test('rotacja utworów zapewnia równe szanse wykonawcom; historia D.1 i brak API', async () => {
  const r = await evaluate(() => {
    const now = Date.now();
    saveLastFmTrackPool([...Array.from({ length: 100 }, (_, i) => ({ artist: 'Dense', track: `Song ${i}`, tags: ['rock'], savedAt: now })), { artist: 'Rare', track: 'Song', tags: ['rock'], savedAt: now }]);
    const picks = lastFmTracksForTags(['rock'], 2);
    return { names: picks.map(r => r.artist).sort(), api: newSearchesThisGeneration };
  });
  assert.deepEqual(r, { names: ['Dense', 'Rare'], api: 0 });
});
test('nieobecna Monika i jej klasyka zachowują reprezentanta podczas floodu rocka', async () => {
  const r = await evaluate(() => {
    renderProfiles();
    document.querySelector('input[data-genre-profile-id="monika"]').value = 'classical';
    document.querySelector('input[data-profile-id="monika"]').checked = false;
    const now = Date.now(); addLastFmArtists(['Common'], { tags: ['rock'] }); addLastFmArtists(['Rare'], { tags: ['classical'] });
    const row = (id, artist, at) => ({ track: { id, uri: `spotify:track:${id}`, name: `Song ${id}`, artists: [{ id: artist === 'Common' ? '1111111111111111111111' : '2222222222222222222222', name: artist }] }, queries: [], savedAt: at });
    const old = [row('rare', 'Rare', now - 2000), ...Array.from({ length: 1999 }, (_, i) => row(`old${i}`, 'Common', now - 1000))];
    const incoming = Array.from({ length: 20 }, (_, i) => row(`new${i}`, 'Common', now));
    saveCandidatePool([...old, ...incoming]);
    return { size: loadCandidatePool().length, retained: loadCandidatePool().some(r => r.track.id === 'rare'), present: selectedProfiles().some(p => p.id === 'monika') };
  });
  assert.deepEqual(r, { size: 2000, retained: true, present: false });
});
test('dwa Days of the New zachowują osobne ID; blokada jednego i duetu nie przenosi się na homonima', async () => {
  const r = await evaluate(() => {
    const now = Date.now(), A = '1111111111111111111111', B = '2222222222222222222222', C = '3333333333333333333333';
    const row = (id, artistId, name, at = now) => ({ track: { id, uri: `spotify:track:${id}`, name: `Song ${id}`, artists: [{ id: artistId, name }] }, queries: [], savedAt: at });
    const a = row('a', A, 'Days of the New'), b = row('b', B, 'Days of the New', now - 2000), duet = row('duet', C, 'Partner'); duet.track.artists.push(a.track.artists[0]);
    addLastFmArtists(['Days of the New'], { tags: ['rock'] });
    setArtistExclusion(a.track, A, 'wrong_artist'); const journal = localStorage.getItem(OfficeArtistExclusions.KEY);
    const old = [a, b, duet, ...Array.from({ length: 1997 }, (_, i) => row(`bad${i}`, C, 'Bad', now - 1000))];
    old.slice(3).forEach(row => { row.track.name += ' - Rework'; });
    saveCandidatePool([...old, row('new', C, 'Bad')]);
    return { b: loadCandidatePool().some(r => r.track.id === 'b'), excluded: [a.track, duet.track, b.track].map(trackHasArtistExclusion), journal: journal === localStorage.getItem(OfficeArtistExclusions.KEY), feedback: [a.track, b.track].map(feedbackScore) };
  });
  assert.deepEqual(r, { b: true, excluded: [true, true, false], journal: true, feedback: [0, 0] });
});
test('opcjonalne snapshoty retencji zachowują dokładnie wyniki rozpoznawalności, feedbacku i punktacji', async () => {
  const r = await evaluate(() => {
    const now = Date.now(), track = { id: 't', uri: 'spotify:track:t', name: 'Song - 2025 Remaster', artists: [{ name: 'Artist' }] };
    addLastFmArtists(['Artist'], { tags: ['rock', 'classic rock'] }); addLastFmTracks([{ name: 'Song', artist: { name: 'Artist' } }], { tags: ['rock'] });
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ [trackSignature(track)]: { value: 1, artists: ['artist'] } }));
    const feedback = loadFeedback(), snap = { artists: loadLastFmArtistPool(), exact: new Set(loadLastFmTrackPool().map(r => trackSignatureFromParts(r.track, [r.artist]))), feedback };
    const fs = { data: feedback, artistStats: feedbackArtistStats(feedback), hardBlocked: feedbackBlockedArtistNames() };
    const selected = [{ id: 'bartek', artists: [], manualGenres: ['rock'], taste: { likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    const a = buildGroupRecommendationContext(selected, [{ track, queries: ['genre:"rock"'], savedAt: now }]), b = buildGroupRecommendationContext(selected, [{ track, queries: ['genre:"rock"'], savedAt: now }]);
    b.retentionSnapshot = snap; b.retentionFeedback = fs;
    return { evidence: JSON.stringify(lastFmEvidenceForTrack(track)) === JSON.stringify(lastFmEvidenceForTrack(track, snap)), feedback: feedbackScore(track) === feedbackScore(track, fs), score: groupCandidateStatic(track, a).groupBase === groupCandidateStatic(track, b).groupBase, pass: recognizabilityPass(track) === recognizabilityPass(track, snap) };
  });
  assert.deepEqual(r, { evidence: true, feedback: true, score: true, pass: true });
});
test('quota i TTL: zapis nie czyści poprzedniej puli ani preferencji', async () => {
  const r = await evaluate(() => {
    const now = Date.now(), track = { id: 'old', uri: 'spotify:track:old', name: 'Song', artists: [{ name: 'Artist' }] };
    saveCandidatePool([{ track, queries: [], savedAt: now }]); const before = localStorage.getItem(CANDIDATE_POOL_KEY);
    localStorage.setItem(FEEDBACK_KEY, '{"keep":true}'); const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === CANDIDATE_POOL_KEY) throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value); };
    try { saveCandidatePool([{ track: { ...track, id: 'new' }, queries: [], savedAt: now }]); } finally { Storage.prototype.setItem = original; }
    const preserved = localStorage.getItem(CANDIDATE_POOL_KEY) === before;
    const expired = mergedCandidatePool([{ track, queries: [], savedAt: now - 31 * 86400000 }], []);
    return { preserved, feedback: localStorage.getItem(FEEDBACK_KEY), expired: expired.length };
  });
  assert.deepEqual(r, { preserved: true, feedback: '{"keep":true}', expired: 0 });
});
for (const people of [2, 4]) test(`porównanie 10 odpowiedzi przy pełnej puli: ${people} osób, jakość/progi i API bez zmian`, async t => {
  const r = await evaluate(async people => {
    Math.random = () => 0.25;
    const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }));
    const empty = () => new Set(), lists = { blockedTracks: empty(), blockedTrackSignatures: empty(), blockedArtists: empty(), historyBlockedNames: empty(), explicitBlockedNames: empty(), feedbackBlockedNames: empty() };
    const now = Date.now(), row = (id, artist, name, at) => ({ track: { id, uri: `spotify:track:${id}`, name, artists: [{ id: `${artist.padEnd(22, '0')}`, name: artist }] }, queries: ['genre:"rock"'], savedAt: at });
    const good = Array.from({ length: 6 }, (_, i) => row(`good${i}`, `Good${Math.floor(i / 2)}`, `Song ${i}`, now - 2000));
    const old = [...good, ...Array.from({ length: 1994 }, (_, i) => row(`bad${i}`, 'Bad', `Bad ${i} - Rework`, now - 1000))];
    addLastFmArtists(['Good0', 'Good1', 'Good2'], { tags: ['rock'] });
    addLastFmTracks(good.map(r => ({ name: r.track.name, artist: { name: r.track.artists[0].name } })), { tags: ['rock'] });
    function generate(rows) {
      localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(rows));
      const ctx = buildGroupRecommendationContext(selected), { eligible, stats } = eligibleGroupCandidates(selected, lists, ctx), result = selectGroupPlaylist(eligible, 6, ctx, stats);
      return { length: result.tracks.length, artists: new Set(result.tracks.map(t => t.artists[0].id)).size, averages: Object.values(result.satisfaction).map(r => r.average) };
    }
    const results = [], originalFetch = window.fetch;
    try {
      for (let seed = 0; seed < 10; seed++) {
        const incoming = Array.from({ length: 10 }, (_, i) => row(`new${seed}-${i}`, 'Bad', `New ${seed} ${i} - Rework`, now));
        const baseline = generate([...old, ...incoming].sort((a, b) => b.savedAt - a.savedAt).slice(0, 2000));
        localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(old)); newSearchesThisGeneration = 0; lastSearchRequestAt = 0;
        window.fetch = async () => new Response(JSON.stringify({ tracks: { items: incoming.map(r => r.track) } }), { status: 200 });
        await searchTracks('mock', `genre:"rock" seed${seed}`, 0);
        const after = generate(loadCandidatePool()); results.push({ baseline, after, api: newSearchesThisGeneration });
      }
    } finally { window.fetch = originalFetch; }
    return results;
  }, people);
  assert.equal(r.length, 10);
  for (const row of r) { assert.equal(row.baseline.length, 0); assert.equal(row.after.length, 6); assert.equal(row.after.artists, 3); assert.equal(row.api, 1); assert.ok(row.after.averages.every(n => Math.abs(n - 56.04) < 1e-9)); }
  t.diagnostic(JSON.stringify({ people, replayCount: r.length, ...r[0] }));
});
test('rzeczywista pula 3000 utworów Last.fm zachowuje 3000 wykonawców po floodzie jednego', async () => {
  const r = await evaluate(() => {
    const now = Date.now();
    localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ artist: `Artist ${i}`, track: `Song ${i}`, tags: ['rock'], savedAt: now - 1000 }))));
    addLastFmTracks(Array.from({ length: 20 }, (_, i) => ({ name: `New ${i}`, artist: { name: 'New' } })), { tags: ['rock'] });
    const pool = loadLastFmTrackPool(); return { size: pool.length, artists: new Set(pool.map(r => r.artist)).size, incoming: pool.filter(r => r.artist === 'New').length };
  });
  assert.deepEqual(r, { size: 3000, artists: 3000, incoming: 1 });
});
test('stan rotacji ograniczony do 64 zestawów; pusty zbiór i awaria quota nie psują wyboru', async () => {
  const r = await evaluate(() => {
    const now = Date.now(), pool = [{ artist: 'Artist', track: 'Song', tags: ['rock'], savedAt: now }];
    for (let i = 0; i < 70; i++) rotateLastFmPool(pool, [`tag${i}`], 1, 'tracks');
    const keys = Object.keys(JSON.parse(localStorage.getItem('office_lastfm_source_rotation_v1'))).length;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'office_lastfm_source_rotation_v1') throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value); };
    let picked; try { picked = rotateLastFmPool(pool, ['rock'], 1, 'tracks').length; } finally { Storage.prototype.setItem = original; }
    return { keys, picked, empty: rotateLastFmPool([], ['unknown'], 18, 'artists').length };
  });
  assert.deepEqual(r, { keys: 64, picked: 1, empty: 0 });
});
test('czas rzeczywistej odpowiedzi Last.fm cache jest przekazywany do nowego rekordu', async () => {
  const r = await evaluate(async () => {
    const savedAt = Date.now() - 10000, params = { tag: 'rock', limit: 40, page: 1 };
    localStorage.setItem(lastFmCacheKey('tag.getTopArtists', params), JSON.stringify({ savedAt, data: { topartists: { artist: [{ name: 'Cached' }] } } }));
    const data = await lastFmRequest('tag.getTopArtists', params);
    addLastFmArtists(data.topartists.artist, { tags: ['rock'], acquiredAt: data.ommAcquiredAt });
    return { same: loadLastFmArtistPool()[0].savedAt === savedAt, hidden: !Object.keys(data).includes('ommAcquiredAt') };
  });
  assert.deepEqual(r, { same: true, hidden: true });
});
test('eksport/import i cold start zachowują pola retencji oraz lokalną rotację, bez nowego klucza D1', async () => {
  const session = await harness.page();
  try {
    const storage = await session.page.evaluate(() => {
      const now = Date.now(), track = { id: 't', uri: 'spotify:track:t', name: 'Song', artists: [{ name: 'Artist' }] };
      saveCandidatePool([{ track, queries: [], savedAt: now, lastUsedAt: now - 1000 }]);
      rotateLastFmPool([{ artist: 'Artist', savedAt: now }], ['rock'], 18, 'artists');
      return exportedStorageState();
    });
    assert.ok(storage.office_lastfm_source_rotation_v1);
    const timestamp = JSON.parse(storage.office_candidate_pool_v1)[0].lastUsedAt;
    await session.page.evaluate(() => { localStorage.removeItem('office_lastfm_source_rotation_v1'); localStorage.removeItem(CANDIDATE_POOL_KEY); });
    session.page.on('dialog', dialog => dialog.accept());
    await Promise.all([
      session.page.waitForNavigation(),
      session.page.locator('#importStateFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'office-music-state', version: 1, storage })) })
    ]);
    await session.page.waitForFunction(() => window.ommStorageReady === true);
    const r = await session.page.evaluate(() => ({ used: loadCandidatePool()[0].lastUsedAt, cloud: cloudStateKeys().includes('office_lastfm_source_rotation_v1'), rotation: localStorage.getItem('office_lastfm_source_rotation_v1') }));
    assert.equal(r.used, timestamp); assert.equal(r.cloud, false); assert.equal(r.rotation, storage.office_lastfm_source_rotation_v1); assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});
