import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
import { auditPool, balancedRetention } from './helpers/pool-audit.mjs';
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(run, arg) {
  const s = await harness.page();
  try { const r = await s.page.evaluate(run, arg); assert.deepEqual(s.errors, []); return r; }
  finally { await s.close(); }
}

test('audit: bilans rozróżnia aktualizację, nowy odrzucony rekord i churn ukryty przez pełną pulę', () => {
  const result = auditPool([{ key: 'a', value: 1 }, { key: 'b', value: 2 }], [{ key: 'a', value: 3 }, { key: 'c', value: 4 }], ['a', 'c', 'd', 'd']);
  assert.deepEqual(result, { before: 2, after: 2, offeredUnique: 3, newOffered: 2, added: 1, updated: 1, changed: 1, removed: 1, rejectedNew: 1, addedKeys: ['c'], removedKeys: ['b'] });
});

for (const pool of ['spotify', 'artists', 'tracks']) test(`audyt pełnej puli ${pool}: dziesięć nowych, jedna aktualizacja, dziesięć usunięć`, async t => {
  const r = await evaluate(({ pool, auditSource }) => {
    const audit = eval(`(${auditSource})`), now = Date.now(), cap = pool === 'spotify' ? 2000 : pool === 'artists' ? 1800 : 3000;
    const make = i => pool === 'spotify' ? { track: { id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ id: '1111111111111111111111', name: 'Old' }] }, queries: ['genre:"rock"'], savedAt: now - 1000 } : pool === 'artists' ? { artist: `Artist ${i}`, tags: ['rock'], sources: ['tag'], recentCount: 0, savedAt: now - 1000 } : { artist: `Artist ${i}`, track: `Song ${i}`, tags: ['rock'], sources: ['tag'], savedAt: now - 1000 };
    const key = pool === 'spotify' ? CANDIDATE_POOL_KEY : pool === 'artists' ? LASTFM_ARTIST_POOL_KEY : LASTFM_TRACK_POOL_KEY;
    const identity = row => pool === 'spotify' ? row.track.id : pool === 'artists' ? normalizeArtistName(row.artist) : `${normalizeArtistName(row.artist)}|${normalizeForSignature(row.track)}`;
    localStorage.setItem(key, JSON.stringify(Array.from({ length: cap }, (_, i) => make(i))));
    const before = JSON.parse(localStorage.getItem(key)), incoming = [make(0), ...Array.from({ length: 10 }, (_, i) => make(cap + i))];
    const start = performance.now();
    if (pool === 'spotify') addToCandidatePool('genre:"rock"', incoming.map(r => r.track));
    else if (pool === 'artists') addLastFmArtists(incoming.map(r => ({ name: r.artist })), { tags: ['rock'] });
    else addLastFmTracks(incoming.map(r => ({ name: r.track, artist: { name: r.artist } })), { tags: ['rock'] });
    const after = JSON.parse(localStorage.getItem(key));
    return { ...audit(before.map(value => ({ key: identity(value), value })), after.map(value => ({ key: identity(value), value })), incoming.map(identity)), elapsedMs: Math.round(performance.now() - start) };
  }, { pool, auditSource: auditPool.toString() });
  assert.equal(r.added, 10); assert.equal(r.updated, 1); assert.equal(r.removed, 10); assert.equal(r.rejectedNew, 0);
  assert.equal(r.before, r.after); assert.equal(r.after, pool === 'spotify' ? 2000 : pool === 'artists' ? 1800 : 3000);
  t.diagnostic(JSON.stringify({ pool, ...r }));
});

test('charakterystyka błędu: recentCount nie maleje, nieobecny artysta utrzymuje wartość po sync i odświeżeniu tagów', async () => {
  const r = await evaluate(async () => {
    const now = Date.now();
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([{ artist: 'Old', tags: ['rock'], sources: ['recent'], recentCount: 99, savedAt: now - 30 * 86400000 }, { artist: 'Seen', tags: ['rock'], sources: ['recent'], recentCount: 20, savedAt: now - 86400000 }]));
    lastFmUserInput.value = 'test'; const original = lastFmRequest;
    lastFmRequest = async () => ({ recenttracks: { '@attr': { totalPages: '1' }, track: [{ name: 'Song', artist: { '#text': 'Seen' }, date: { uts: String(Math.floor(now / 1000)) } }] } });
    try { await syncLastFmSources([], { includeTags: false, includeRecent: true }); }
    finally { lastFmRequest = original; }
    addLastFmArtists(['Old'], { tags: ['rock'] });
    return loadLastFmArtistPool().map(r => ({ artist: r.artist, count: r.recentCount, refreshed: r.savedAt >= now }));
  });
  assert.deepEqual(r, [{ artist: 'Old', count: 99, refreshed: true }, { artist: 'Seen', count: 20, refreshed: true }]);
});

test('pełna pula wykonawców z dawnym recentCount odrzuca wszystkich nowych wykonawców z tagów', async t => {
  const r = await evaluate(({ auditSource }) => {
    const now = Date.now(), audit = eval(`(${auditSource})`);
    const old = Array.from({ length: 1800 }, (_, i) => ({ artist: `Old ${i}`, tags: ['rock'], sources: ['recent'], recentCount: 10, savedAt: now - 86400000 }));
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(old));
    const offered = Array.from({ length: 20 }, (_, i) => `New ${i}`);
    addLastFmArtists(offered, { tags: ['jazz'] });
    const after = loadLastFmArtistPool();
    return audit(old.map(value => ({ key: normalizeArtistName(value.artist), value })), after.map(value => ({ key: normalizeArtistName(value.artist), value })), offered.map(normalizeArtistName));
  }, { auditSource: auditPool.toString() });
  assert.equal(r.added, 0); assert.equal(r.rejectedNew, 20); assert.equal(r.removed, 0); t.diagnostic(JSON.stringify(r));
});

test('limit trzech stron i top 40: recentCount dotyczy części obserwacji, nie całego okna 14 dni', async () => {
  const r = await evaluate(async () => {
    lastFmUserInput.value = 'test'; const original = lastFmRequest; let calls = 0;
    lastFmRequest = async () => { calls++; return { recenttracks: { '@attr': { totalPages: '4' }, track: Array.from({ length: 200 }, (_, i) => ({ name: 'Song', artist: { '#text': `Artist ${i}` }, date: { uts: String(Math.floor(Date.now() / 1000) - i) } })) } }; };
    try { await syncLastFmSources([], { includeTags: false, includeRecent: true }); return { calls, artists: loadLastFmArtistPool().length, observed: lastFmRecentCount() }; }
    finally { lastFmRequest = original; }
  });
  assert.deepEqual(r, { calls: 3, artists: 40, observed: 600 });
});

test('prototyp na kopii: retencja po wykonawcach ogranicza koncentrację bez zmiany limitów', t => {
  for (const cap of [2000, 3000]) {
    const old = Array.from({ length: cap }, (_, i) => ({ key: `old${i}`, artist: `Artist ${i}`, valuable: i === cap - 1, savedAt: 1 }));
    const incoming = Array.from({ length: 20 }, (_, i) => ({ key: `new${i}`, artist: 'New', valuable: false, savedAt: 2 }));
    const naive = [...incoming, ...old].slice(0, cap), balanced = balancedRetention([...old, ...incoming], cap);
    const unique = rows => new Set(rows.map(r => r.artist)).size;
    assert.equal(balanced.length, cap); assert.equal(unique(naive), cap - 19); assert.equal(unique(balanced), cap);
    assert.equal(balanced.some(r => r.key === `old${cap - 1}`), true); assert.equal(naive.some(r => r.key === `old${cap - 1}`), false);
    t.diagnostic(JSON.stringify({ cap, naiveArtists: unique(naive), balancedArtists: unique(balanced), naiveLostValuable: 1, balancedLostValuable: 0 }));
  }
});

test('TTL usuwa przy odczycie logicznym; zapis fizycznie usuwa wygasłe rekordy', async () => {
  const r = await evaluate(() => {
    const expired = { artist: 'Old', tags: ['rock'], sources: ['tag'], recentCount: 0, savedAt: Date.now() - 46 * 86400000 };
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([expired]));
    const logical = loadLastFmArtistPool().length, physicalBefore = JSON.parse(localStorage.getItem(LASTFM_ARTIST_POOL_KEY)).length;
    addLastFmArtists(['New'], { tags: ['rock'] });
    return { logical, physicalBefore, physicalAfter: JSON.parse(localStorage.getItem(LASTFM_ARTIST_POOL_KEY)).map(r => r.artist) };
  });
  assert.deepEqual(r, { logical: 0, physicalBefore: 1, physicalAfter: ['New'] });
});

for (const multiplier of [1, 1.5, 2]) test(`symulacja rozmiaru ${multiplier}×: pule, shadow i faktyczne kodowanie żądania`, async t => {
  const r = await evaluate(({ multiplier }) => {
    const now = Date.now(), enc = s => new TextEncoder().encode(s).length;
    const sf = Array.from({ length: Math.round(2000 * multiplier) }, (_, i) => ({ track: { id: String(i).padStart(22, '0'), uri: `spotify:track:${String(i).padStart(22, '0')}`, name: `Song ${i}`, artists: [{ id: String(Math.floor(i / 2)).padStart(22, '0'), name: `Artist ${Math.floor(i / 2)}` }], album: { name: `Album ${i}` } }, queries: ['genre:"rock"'], savedAt: now }));
    const artists = Array.from({ length: Math.round(1800 * multiplier) }, (_, i) => ({ artist: `Artist ${i}`, tags: ['rock', 'alternative rock'], sources: ['tag'], recentCount: 0, savedAt: now }));
    const tracks = Array.from({ length: Math.round(3000 * multiplier) }, (_, i) => ({ artist: `Artist ${Math.floor(i / 2)}`, track: `Song ${i}`, tags: ['rock'], sources: ['tag'], savedAt: now, catalogEvidence: [{ artistName: `Artist ${Math.floor(i / 2)}`, trackName: `Song ${i}`, album: `Album ${i}`, artistMbid: '', trackMbid: '' }] }));
    const raw = [sf, artists, tracks].map(JSON.stringify);
    const state = { office_candidate_pool_v1: raw[0] }, body = JSON.stringify({ state });
    saveCloudShadow(state); const shadow = localStorage.getItem(CLOUD_SHADOW_KEY);
    const start = performance.now(); for (let i = 0; i < 5; i++) raw.forEach(JSON.parse); const parseMs = (performance.now() - start) / 5;
    return { multiplier, spotifyBytes: enc(raw[0]), artistBytes: enc(raw[1]), trackBytes: enc(raw[2]), encodedSpotifyValueBytes: enc(JSON.stringify(raw[0])), payloadBytes: enc(body), utf16PoolsPlusShadowBytes: raw.reduce((n, s) => n + 2 * s.length, 0) + 2 * shadow.length, shadowBytes: enc(shadow), shadowContainsSpotify: Object.hasOwn(JSON.parse(shadow), CANDIDATE_POOL_KEY), parseMs: Math.round(parseMs * 100) / 100, cloudHasLastfmArtists: cloudStateKeys().includes(LASTFM_ARTIST_POOL_KEY), cloudHasLastfmTracks: cloudStateKeys().includes(LASTFM_TRACK_POOL_KEY) };
  }, { multiplier });
  assert.equal(r.cloudHasLastfmArtists, false); assert.equal(r.cloudHasLastfmTracks, false); assert.equal(r.shadowContainsSpotify, false);
  t.diagnostic(JSON.stringify(r));
});

test('sortowanie świeżych wyników Spotify usuwa najstarszy kwalifikowalny rekord mimo niekwalifikowalnego floodu', async () => {
  const r = await evaluate(() => {
    const now = Date.now(), selected = [{ id: 'bartek', genres: ['rock'], artists: [], categories: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    const good = { id: 'valuable', uri: 'spotify:track:valuable', name: 'Song', artists: [{ id: '1111111111111111111111', name: 'Good' }] };
    addLastFmArtists(['Good'], { tags: ['rock'] });
    const bad = i => ({ id: `bad${i}`, uri: `spotify:track:bad${i}`, name: `Song ${i} - Rework`, artists: [{ id: '2222222222222222222222', name: 'Bad' }] });
    localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify([{ track: good, queries: ['genre:"rock"'], savedAt: now - 2000 }, ...Array.from({ length: 1999 }, (_, i) => ({ track: bad(i), queries: ['genre:"rock"'], savedAt: now - 1000 }))]));
    const blocks = generationBlocklists(selected), before = acquisitionCoverage(selected, blocks).artists;
    addToCandidatePool('genre:"rock"', [bad(2000)]);
    return { before, after: acquisitionCoverage(selected, blocks).artists, retained: loadCandidatePool().some(r => r.track.id === 'valuable') };
  });
  assert.deepEqual(r, { before: 1, after: 0, retained: false });
});

test('cloud merge również wypiera stare rekordy: limit 2000 nie jest ochroną różnorodności', async () => {
  const r = await evaluate(() => {
    const row = (id, savedAt) => ({ track: { id, uri: `spotify:track:${id}`, name: id, artists: [{ name: id }] }, queries: [], savedAt });
    const now = Date.now(), local = Array.from({ length: 2000 }, (_, i) => row(`old${i}`, now - 1000)), remote = [row('new', now)];
    const merged = mergedCandidatePool(JSON.stringify(local), JSON.stringify(remote));
    return { length: merged.length, added: merged.some(r => r.track.id === 'new'), removed: local.filter(r => !merged.some(m => m.track.id === r.track.id)).map(r => r.track.id) };
  });
  assert.deepEqual(r, { length: 2000, added: true, removed: ['old1999'] });
});

test('rotacja tagów obejmuje całą kolejkę, ale wykonawcy spoza head 3×18 nigdy nie są proponowani', async () => {
  const r = await evaluate(() => {
    localStorage.removeItem(LASTFM_TAG_ROTATION_KEY); localStorage.removeItem(POLISH_TAG_ROTATION_KEY);
    const tags = Array.from({ length: 60 }, (_, i) => `tag${i}`), picked = new Set();
    for (let i = 0; i < 10; i++) rotatingLastFmTags(tags, 12).forEach(t => picked.add(t));
    const polish = new Set(); for (let i = 0; i < 5; i++) rotatingPolishLastFmTags(2).forEach(t => polish.add(t));
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(Array.from({ length: 1800 }, (_, i) => ({ artist: `Artist ${i}`, tags: ['rock'], recentCount: 1800 - i, sources: ['tag'], savedAt: Date.now() }))));
    const artists = new Set(); for (let i = 0; i < 20; i++) lastFmArtistsForTags(['rock'], 18).forEach(a => artists.add(Number(a.split(' ')[1])));
    return { tags: picked.size, polish: polish.size, maxArtistIndex: Math.max(...artists), uniqueArtists: artists.size };
  });
  assert.equal(r.tags, 60); assert.equal(r.polish, 5); assert.ok(r.maxArtistIndex < 54); assert.ok(r.uniqueArtists <= 54);
});
