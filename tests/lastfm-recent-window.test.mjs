import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness.close(); });
async function run(fn, arg) {
  const s = await harness.page();
  try { const result = await s.page.evaluate(fn, arg); assert.deepEqual(s.errors, []); return result; }
  finally { await s.close(); }
}
for (const complete of [true, false]) test(`obserwacja ${complete ? 'pełna zeruje nieobecnych' : 'częściowa zachowuje nieobecnych'}, licznik maleje`, async () => {
  const r = await run(complete => {
    localStorage.setItem(LASTFM_USER_KEY, 'Alice');
    const now = Date.now(), obs = { user: 'alice', observedAt: now, from: 0, to: now / 1000, complete: true };
    applyLastFmRecentObservation(new Map([['seen', 'Seen'], ['absent', 'Absent']]), new Map([['seen', Array(99).fill(now / 1000 - 100)], ['absent', [now / 1000 - 100]]]), obs);
    applyLastFmRecentObservation(new Map([['seen', 'Seen']]), new Map([['seen', [now / 1000 - 10]]]), { ...obs, complete });
    return Object.fromEntries(loadLastFmArtistPool().map(r => [r.artist, r.recentCount]));
  }, complete);
  assert.deepEqual(r, { Seen: 1, Absent: complete ? 0 : 1 });
});
test('tagi nie odnawiają dowodów; stare, przyszłe i obce odsłuchy nie liczą się, legacy nie jest aktualnym dowodem', async () => {
  const r = await run(() => {
    localStorage.setItem(LASTFM_USER_KEY, 'alice'); const now = Date.now();
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([{ artist: 'Legacy', recentCount: 99, tags: ['rock'], savedAt: now }]));
    applyLastFmRecentObservation(new Map([['dated', 'Dated']]), new Map([['dated', [now / 1000 - 14 * 86400 - 1, now / 1000 - 10, now / 1000 + 100]]]), { user: 'alice', observedAt: now - 100, complete: false });
    addLastFmArtists(['Dated'], { tags: ['rock'] });
    const same = loadLastFmArtistPool().find(r => r.artist === 'Dated');
    const legacy = loadLastFmArtistPool().find(r => r.artist === 'Legacy');
    const expires = lastFmRecentEvidenceCount(same, now + 14 * 86400000);
    localStorage.setItem(LASTFM_USER_KEY, 'bob');
    return { same: same.recentCount, timestamp: same.recentObservation.observedAt === now - 100, legacy: legacy.recentCount, tags: legacy.tags, expires, other: loadLastFmArtistPool().find(r => r.artist === 'Dated').recentCount };
  });
  assert.deepEqual(r, { same: 1, timestamp: true, legacy: 0, tags: ['rock'], expires: 0, other: 0 });
});
for (const scenario of ['full', 'partial', 'error', 'switch', 'malformed', 'empty']) test(`rzeczywista synchronizacja: ${scenario}`, async () => {
  const r = await run(async scenario => {
    lastFmUserInput.value = 'alice'; localStorage.setItem(LASTFM_USER_KEY, 'alice');
    const now = Date.now(), uts = Math.floor(now / 1000) - 20;
    applyLastFmRecentObservation(new Map([['old', 'Old']]), new Map([['old', [uts]]]), { user: 'alice', observedAt: now, complete: true });
    let calls = 0; const original = lastFmRequest;
    lastFmRequest = async (_method, params) => {
      calls++;
      if (scenario === 'error' && calls === 2) throw new Error('offline');
      if (scenario === 'switch') localStorage.setItem(LASTFM_USER_KEY, 'bob');
      if (scenario === 'malformed') return {};
      return { recenttracks: { '@attr': { totalPages: scenario === 'partial' ? '4' : scenario === 'error' ? '2' : '1' }, track: scenario === 'empty' ? [] : [{ name: `Song ${params.page}`, artist: { '#text': 'New' }, date: { uts: String(uts - params.page) } }] } };
    };
    try { await syncLastFmSources([], { includeTags: false }); }
    finally { lastFmRequest = original; }
    const raw = JSON.parse(localStorage.getItem(LASTFM_ARTIST_POOL_KEY));
    return { calls, old: raw.find(r => r.artist === 'Old').recentObservation.plays.length, next: raw.find(r => r.artist === 'New')?.recentObservation.plays.length || 0, complete: raw.find(r => r.artist === 'New')?.recentObservation.complete ?? null };
  }, scenario);
  if (scenario === 'full') assert.deepEqual(r, { calls: 1, old: 0, next: 1, complete: true });
  else if (scenario === 'partial') assert.deepEqual(r, { calls: 3, old: 1, next: 3, complete: false });
  else if (scenario === 'empty') assert.deepEqual(r, { calls: 1, old: 0, next: 0, complete: null });
  else { assert.equal(r.old, 1); assert.equal(r.next, 0); }
});
test('quota zachowuje poprzednią obserwację', async () => {
  const r = await run(() => {
    localStorage.setItem(LASTFM_USER_KEY, 'alice'); const now = Date.now();
    applyLastFmRecentObservation(new Map([['old', 'Old']]), new Map([['old', [now / 1000 - 10]]]), { user: 'alice', observedAt: now, complete: true });
    const before = localStorage.getItem(LASTFM_ARTIST_POOL_KEY), original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === LASTFM_ARTIST_POOL_KEY) throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value); };
    let ok; try { ok = applyLastFmRecentObservation(new Map(), new Map(), { user: 'alice', observedAt: now, complete: true }); } finally { Storage.prototype.setItem = original; }
    return { ok, preserved: before === localStorage.getItem(LASTFM_ARTIST_POOL_KEY) };
  });
  assert.deepEqual(r, { ok: false, preserved: true });
});
for (const people of [2, 4]) test(`wpływ na playlistę ${people} osób: brak sztucznego recent, długość zachowana`, async t => {
  const r = await run(people => {
    Math.random = () => 0.25; localStorage.setItem(LASTFM_USER_KEY, 'alice');
    const now = Date.now();
    const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }));
    const tracks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ name: `Artist ${i}` }], album: { name: 'Album' } }));
    saveCandidatePool(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now })));
    localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.map(track => ({ artist: track.artists[0].name, track: track.name, tags: ['rock'], sources: ['tag'], savedAt: now }))));
    const pool = tracks.map(track => ({ artist: track.artists[0].name, tags: ['rock'], sources: ['tag', 'recent'], recentCount: 99, savedAt: now }));
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(pool));
    function generate() {
      const ctx = buildGroupRecommendationContext(selected), empty = () => new Set();
      const lists = { blockedTracks: empty(), blockedTrackSignatures: empty(), blockedArtists: empty(), historyBlockedNames: empty(), explicitBlockedNames: empty(), feedbackBlockedNames: empty() };
      const { eligible, stats } = eligibleGroupCandidates(selected, lists, ctx), result = selectGroupPlaylist(eligible, 6, ctx, stats);
      return { length: result.tracks.length, averages: Object.values(result.satisfaction).map(row => row.average) };
    }
    const currentLoad = loadLastFmArtistPool;
    loadLastFmArtistPool = () => JSON.parse(localStorage.getItem(LASTFM_ARTIST_POOL_KEY) || "[]");
    let legacy; try { legacy = generate(); } finally { loadLastFmArtistPool = currentLoad; }
    const noRecent = generate();
    applyLastFmRecentObservation(new Map(pool.map(r => [normalizeArtistName(r.artist), r.artist])), new Map(pool.map(r => [normalizeArtistName(r.artist), [now / 1000 - 10]])), { user: 'alice', observedAt: now, complete: true });
    return { legacy, noRecent, confirmedRecent: generate() };
  }, people);
  assert.equal(r.legacy.length, 6); assert.equal(r.noRecent.length, 6); assert.equal(r.confirmedRecent.length, 6); assert.ok(r.noRecent.averages.every(n => n >= 35));
  t.diagnostic(JSON.stringify({ people, ...r }));
});
test('wszystkie 55 nazwisk otrzymują dowód, bez ograniczenia top 40; duplikaty i poza oknem nie zawyżają wyniku', async () => {
  const r = await run(async () => {
    lastFmUserInput.value = 'alice'; const uts = Math.floor(Date.now() / 1000) - 10, original = lastFmRequest;
    const tracks = Array.from({ length: 55 }, (_, i) => ({ name: 'Song', artist: { '#text': `Artist ${i}` }, date: { uts: String(uts) } }));
    lastFmRequest = async () => ({ recenttracks: { '@attr': { totalPages: '1' }, track: [...tracks, tracks[0], { ...tracks[0], date: { uts: String(uts - 15 * 86400) } }, { ...tracks[0], date: { uts: String(uts + 1000) } }] } });
    try { await syncLastFmSources([], { includeTags: false }); } finally { lastFmRequest = original; }
    return { count: lastFmRecentCount(), artists: loadLastFmArtistPool().filter(r => r.recentCount === 1).length, complete: loadLastFmArtistPool()[0].recentObservation.complete };
  });
  assert.deepEqual(r, { count: 55, artists: 55, complete: false });
});
test('zmiana konta usuwa recent ze źródeł dowodowych bez usuwania tagów ani surowego rekordu', async () => {
  const r = await run(() => {
    localStorage.setItem(LASTFM_USER_KEY, 'alice'); const now = Date.now();
    addLastFmArtists(['Artist'], { tags: ['rock'] });
    applyLastFmRecentObservation(new Map([['artist', 'Artist']]), new Map([['artist', [now / 1000 - 10]]]), { user: 'alice', observedAt: now, complete: true });
    localStorage.setItem(LASTFM_USER_KEY, 'bob');
    const row = loadLastFmArtistPool()[0];
    return { count: row.recentCount, sources: row.sources, tags: row.tags, storedOwner: JSON.parse(localStorage.getItem(LASTFM_ARTIST_POOL_KEY))[0].recentObservation.user };
  });
  assert.deepEqual(r, { count: 0, sources: ['tag'], tags: ['rock'], storedOwner: 'alice' });
});
test('nowe konto wymaga historii mimo świeżego terminu synchronizacji poprzedniego', async () => {
  const r = await run(async () => {
    const now = Date.now(); localStorage.setItem(LASTFM_AUTO_TAG_SYNC_KEY, String(now)); localStorage.setItem(LASTFM_AUTO_RECENT_SYNC_KEY, String(now));
    localStorage.setItem(LASTFM_RECENT_OBSERVATION_KEY, JSON.stringify({ user: 'alice', observedAt: now, complete: true, count: 1 }));
    lastFmUserInput.value = 'bob'; let calls = 0; const original = lastFmRequest;
    lastFmRequest = async () => { calls++; return { recenttracks: { '@attr': { totalPages: '0' }, track: [] } }; };
    try { const due = await refreshLastFmBeforeGeneration([], 60); return { ...due, calls }; } finally { lastFmRequest = original; }
  });
  assert.deepEqual(r, { tagsDue: false, recentDue: true, calls: 1 });
});
test('zmiana liczby stron w trakcie pobrania nie uprawnia do zerowania nieobserwowanych', async () => {
  const r = await run(async () => {
    localStorage.setItem(LASTFM_USER_KEY, 'alice'); lastFmUserInput.value = 'alice'; const now = Date.now();
    applyLastFmRecentObservation(new Map([['old', 'Old']]), new Map([['old', [now / 1000 - 10]]]), { user: 'alice', observedAt: now, complete: true });
    const original = lastFmRequest;
    lastFmRequest = async (_m, params) => ({ recenttracks: { '@attr': { totalPages: params.page === 1 ? '2' : '1' }, track: [] } });
    try { await syncLastFmSources([], { includeTags: false }); } finally { lastFmRequest = original; }
    return { count: loadLastFmArtistPool()[0].recentCount, complete: JSON.parse(localStorage.getItem(LASTFM_RECENT_OBSERVATION_KEY)).complete };
  });
  assert.deepEqual(r, { count: 1, complete: false });
});
test('wolniejsza odpowiedź nie nadpisuje nowszej obserwacji tego samego konta', async () => {
  const r = await run(async () => {
    localStorage.setItem(LASTFM_USER_KEY, 'alice'); lastFmUserInput.value = 'alice'; const now = Date.now(), original = lastFmRequest;
    lastFmRequest = async () => {
      applyLastFmRecentObservation(new Map([['newer', 'Newer']]), new Map([['newer', [now / 1000 - 10]]]), { user: 'alice', observedAt: now + 1000, complete: true });
      localStorage.setItem(LASTFM_RECENT_OBSERVATION_KEY, JSON.stringify({ user: 'alice', observedAt: now + 1000, complete: true, count: 1 }));
      return { recenttracks: { '@attr': { totalPages: '1' }, track: [] } };
    };
    try { await syncLastFmSources([], { includeTags: false }); } finally { lastFmRequest = original; }
    return loadLastFmArtistPool().map(r => ({ artist: r.artist, count: r.recentCount }));
  });
  assert.deepEqual(r, [{ artist: 'Newer', count: 1 }]);
});
