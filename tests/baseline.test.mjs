import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

async function withPage(run, path = '/', storage = {}) {
  const session = await harness.page(path, storage);
  try { await run(session.page); assert.deepEqual(session.errors, []); }
  finally { await session.close(); }
}

for (const path of ['/', '/taste.html']) {
  test(`cold start ${path} bez błędów runtime`, () => withPage(async page => {
    assert.match(await page.title(), /Office Music Mixer/);
    if (path === '/') await page.locator('#status').getByText('Niepołączony', { exact: true }).waitFor();
    else assert.equal(await page.locator('[data-person]').count(), 4);
  }, path));
}

test('ankieta zachowuje ocenę po odświeżeniu i zmianie osoby', () => withPage(async page => {
  await page.locator('[data-person="Bartek"]').click();
  await page.locator('.choices[data-id="rock"] .choice[data-val="like"]').click();
  await page.reload();
  await page.locator('[data-person="Bartek"]').click();
  const value = await page.evaluate(() => JSON.parse(localStorage.getItem('office_taste_profile_v1')).people.Bartek.genres.rock);
  assert.equal(value, 'like');
  await page.locator('#changePerson').click();
  await page.locator('[data-person="Edyta"]').click();
  assert.equal(await page.locator('#activePerson').textContent(), 'Edyta');
}, '/taste.html'));

for (const count of [2, 4]) {
  test(`model grupowy: ${count} osoby, limit artysty i deduplikacja`, () => withPage(async page => {
    const result = await page.evaluate(count => {
      Math.random = () => 0.25;
      const selected = ['bartek', 'edyta', 'asia', 'monika'].slice(0, count).map(id => ({
        id, artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] }
      }));
      const tracks = Array.from({ length: 18 }, (_, i) => ({
        id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i % 3 === 1 ? i - 1 : i}`,
        artists: [{ id: `a${Math.floor(i / 3)}`, name: `Artist ${Math.floor(i / 3)}` }], album: { name: 'Album' }
      }));
      const now = Date.now();
      saveCandidatePool(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now })));
      localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.map(track => ({
        artist: track.artists[0].name, track: track.name, tags: ['rock'], sources: ['tag'], savedAt: now
      }))));
      const ctx = buildGroupRecommendationContext(selected);
      const empty = () => new Set();
      const { eligible, stats } = eligibleGroupCandidates(selected, {
        blockedTracks: empty(), blockedTrackSignatures: empty(), blockedArtists: empty(),
        historyBlockedNames: empty(), explicitBlockedNames: empty(), feedbackBlockedNames: empty()
      }, ctx);
      const result = selectGroupPlaylist(eligible, 18, ctx, stats);
      const ordered = sequencePlaylistForListening(result.tracks);
      const counts = {};
      for (const track of ordered) for (const key of trackArtistKeys(track)) counts[key] = (counts[key] || 0) + 1;
      return { length: ordered.length, ids: ordered.map(t => t.id), signatures: ordered.map(trackSignature), counts, satisfaction: result.satisfaction };
    }, count);
    assert.equal(result.length, 12);
    assert.equal(new Set(result.ids).size, 12);
    assert.equal(new Set(result.signatures).size, 12);
    assert.ok(Object.values(result.counts).every(value => value <= 2));
    assert.equal(Object.keys(result.satisfaction).length, count);
    assert.ok(Object.values(result.satisfaction).every(row => row.average >= 35));
  }));
}

test('historia blokuje odsłuchania, nie samo wygenerowanie', () => withPage(async page => {
  const result = await page.evaluate(() => {
    const track = { trackId: 'heard', trackName: 'Song', artistIds: ['artist'], artistNames: ['Artist'], playedAt: new Date().toISOString() };
    localStorage.setItem(HISTORY_KEY, JSON.stringify([{ ...track, source: 'spotify' }, { ...track, trackId: 'generated', source: 'generated' }]));
    const lists = buildHistoryBlocklists();
    return { tracks: [...lists.blockedTracks], artists: [...lists.blockedArtists] };
  });
  assert.deepEqual(result, { tracks: ['heard'], artists: ['artist'] });
}));

test('v43 A: kara wykonawcy blokuje normalną selekcję i fallback', () => withPage(async page => {
  const result = await page.evaluate(() => {
    const ctx = buildGroupRecommendationContext([{ id: 'bartek', artists: [], taste: {} }]);
    const track = { id: 'one', uri: 'spotify:track:one', name: 'One', artists: [{ name: 'Artist' }] };
    const item = groupCandidateStatic(track, ctx);
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ 'other|artist': { value: -1, artists: ['artist'] } }));
    item.features.feedback = -55;
    item.groupBase = 60;
    item.minScore = 60;
    const normal = selectGroupPlaylist([item], 1, ctx, newRejectionStats(1));
    item.groupBase = 36;
    const fallback = selectGroupPlaylist([item], 1, ctx, newRejectionStats(1));
    return { normal: normal.tracks.length, fallback: fallback.tracks.length };
  });
  assert.deepEqual(result, { normal: 0, fallback: 0 });
}));

test('v43 C: końcowy fallback discovery respektuje faktyczną długość', () => withPage(async page => {
  const result = await page.evaluate(() => {
    Math.random = () => 0.25;
    discoveryLevel.value = '30';
    const ctx = buildGroupRecommendationContext([{ id: 'bartek', artists: [], taste: {} }]);
    const items = Array.from({ length: 30 }, (_, i) => {
      const track = { id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ name: `Artist ${i}` }] };
      const item = groupCandidateStatic(track, ctx);
      item.groupBase = 36; item.minScore = 40; item.byUser.bartek.score = 40;
      return item;
    });
    const result = selectGroupPlaylist(items, 60, ctx, newRejectionStats(items.length));
    return { count: result.tracks.length, discovery: result.discoveryCount, targetMax: result.requestedDiscoveryQuota.max, actualMax: result.discoveryQuota.max };
  });
  assert.equal(result.count, 0);
  assert.equal(result.discovery, 0);
  assert.equal(result.targetMax, 21);
  assert.ok(result.discovery <= result.actualMax);
}));

test('wersje live/remix i remaster ze zwykłym wydaniem', () => withPage(async page => {
  const result = await page.evaluate(() => {
    const track = name => ({ id: name, name, artists: [{ name: 'Artist' }], album: { name: 'Album' } });
    rebuildCanonicalCleanVariantSignatures([{ track: track('Song') }]);
    return ['Song - Live', 'Song (Remix)', 'Song - 2025 Remaster', 'Song'].map(name => looksLikeUnwantedVariant(track(name)));
  });
  assert.deepEqual(result, [true, true, true, false]);
}));

test('eksport/import zachowuje dane i pomija tokeny Spotify', () => withPage(async page => {
  await page.evaluate(() => {
    localStorage.setItem('office_seed_bartek', 'Queen');
    localStorage.setItem('spotify_access_token', 'test-only');
  });
  const storage = await page.evaluate(() => exportedStorageState());
  assert.equal(storage.office_seed_bartek, 'Queen');
  assert.ok(!Object.hasOwn(storage, 'spotify_access_token'));
  await page.evaluate(() => localStorage.setItem('office_seed_bartek', 'Changed'));
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#importStateFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'office-music-state', version: 1, storage })) });
  await page.waitForFunction(() => localStorage.getItem('office_seed_bartek') === 'Queen');
}));

test('bezpieczny zapis usuwa cache po quota i chroni preferencje', () => withPage(async page => {
  const result = await page.evaluate(() => {
    localStorage.setItem('office_seed_bartek', 'Queen');
    localStorage.setItem('office_search_cache_v1:disposable', '{}');
    const original = Storage.prototype.setItem;
    let fail = true;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'office_test' && fail) { fail = false; throw new DOMException('Full', 'QuotaExceededError'); }
      return original.call(this, key, value);
    };
    try {
      return { saved: safeSetSmallStorageItem('office_test', 'ok'), seed: localStorage.getItem('office_seed_bartek'), cache: localStorage.getItem('office_search_cache_v1:disposable') };
    } finally { Storage.prototype.setItem = original; }
  });
  assert.deepEqual(result, { saved: true, seed: 'Queen', cache: null });
}));

test('wyszukiwanie: Retry-After, quota i błąd sieci bez prawdziwego API', () => withPage(async page => {
  const result = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    const originalSleep = sleep;
    const originalWait = waitForSearchSlot;
    const waits = [];
    sleep = async ms => waits.push(ms); waitForSearchSlot = async () => {};
    let calls = 0;
    try {
      window.fetch = async () => ++calls === 1
        ? new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })
        : Response.json({ tracks: { items: [] } });
      await searchTracks('test', 'genre:"test-retry"');
      window.fetch = async () => Response.json({ error: { reason: 'QUOTA_EXCEEDED' } }, { status: 429 });
      let quota = ''; try { await searchTracks('test', 'genre:"test-quota"'); } catch (e) { quota = e.message; }
      window.fetch = async () => { throw new TypeError('Offline'); };
      let offline = ''; try { await searchTracks('test', 'genre:"test-offline"'); } catch (e) { offline = e.message; }
      return { calls, waits, quota, offline };
    } finally { window.fetch = originalFetch; sleep = originalSleep; waitForSearchSlot = originalWait; }
  });
  assert.equal(result.calls, 2); assert.deepEqual(result.waits, [2250]);
  assert.match(result.quota, /quota/); assert.equal(result.offline, 'Offline');
}));

test('RMF: właściwy dzień i nazwa wydania, bez sportu', () => withPage(async page => {
  const result = await page.evaluate(() => {
    const episodes = [{ name: '09:00 Fakty sportowe', release_date: '2026-10-08' }, { name: '09:00 Fakty', release_date: '2026-10-07' }, { name: '09:00 Fakty', release_date: '2026-10-08', uri: 'expected' }];
    return findRmfEpisodeForSlot(episodes, '2026-10-08', 9)?.uri;
  });
  assert.equal(result, 'expected');
}));
