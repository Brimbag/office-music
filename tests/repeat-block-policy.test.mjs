import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';

// Characterization of stable 1.0.12, not approval of a new skip cooldown.
const TRACK = '70cHKK8bHAfJrOGVnfRG9J';
const FIRST = Date.parse('2026-10-15T17:07:42+02:00');
const SECOND = Date.parse('2026-10-16T16:27:11+02:00');
const DAY = 86400000;
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

async function setup(page, at = FIRST) {
  await page.evaluate(({ at, trackId }) => {
    window.auditNow = at;
    Date.now = () => auditNow;
    Math.random = () => .25;
    localStorage.setItem('spotify_access_token', 'mock-token');
    localStorage.setItem('spotify_token_expires', String(at + 3600000));
    lastFmSpotifyAccount = 'mock-public'; autoFeedbackAccount = 'mock-owner';
    playbackSessionTag = 'audit'; playbackSessionVerified = true;
    playbackVerifiedAccess = 'mock-token'; playbackSessionNeedsCheck = false;
    window.auditTrack = { id: trackId, uri: `spotify:track:${trackId}`,
      name: 'Nicole Kidman', artists: [{ id: 'artistAdela', name: 'ADÉLA' }],
      album: { name: 'Synthetic audit fixture' } };
    window.auditProfiles = ['bartek', 'asia'].map(id => ({ id, genres: ['rock'],
      artists: [], categories: [], taste: { hasSurvey: true,
        likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }));
    trackBlockDays.value = '14'; artistCooldownHours.value = '0';
    discoveryLevel.value = '0';
    window.auditEvent = (id, at, kind = 'early') => ({ version: 1,
      account: 'mock-owner', id, trackId, playlistId: 'mockPlaylist', at,
      durationMs: 200000, fromMs: kind === 'early' ? 14600 : 42800,
      toMs: kind === 'early' ? 26600 : 53600, kind });
    window.auditGenerate = () => {
      const rows = loadCandidatePool(), ctx = acquisitionContext(auditProfiles, rows);
      const { eligible, stats } = eligibleGroupCandidates(auditProfiles,
        generationBlocklists(auditProfiles), ctx, rows);
      const result = selectGroupPlaylist(eligible, 1, ctx, stats);
      return { ids: result.tracks.map(t => t.id), recent: stats.recentTrack,
        auto: eligible[0]?.features.autoFeedback, base: eligible[0]?.groupBase };
    };
  }, { at, trackId: TRACK });
}

async function seed(page) {
  await page.evaluate(() => {
    addLastFmTracks([{ name: auditTrack.name, artist: { name: 'ADÉLA' } }], { tags: ['rock'] });
    saveCandidatePool([{ track: auditTrack, queries: ['genre:"rock"'], savedAt: Date.now() }]);
  });
}

test('15 Oct early penalty / 16 Oct middle penalty: S2 reduces score, creates no history block', async () => {
  const s = await harness.page();
  try {
    await setup(s.page); await seed(s.page);
    const r = await s.page.evaluate(async ({ first, second }) => {
      await autoTrackFeedback.configure(true);
      const firstSaved = await autoTrackFeedback.record(auditEvent('first', first));
      auditNow = second;
      const beforeSecond = auditGenerate();
      const secondSaved = await autoTrackFeedback.record(auditEvent('second', second, 'middle'));
      return { firstSaved, secondSaved, beforeSecond, afterSecond: auditGenerate(),
        history: loadHistory(), events: autoTrackFeedback.state('mock-owner').events };
    }, { first: FIRST, second: SECOND });
    assert.equal(r.firstSaved, true); assert.equal(r.secondSaved, true);
    assert.deepEqual(r.beforeSecond.ids, [TRACK]); assert.deepEqual(r.afterSecond.ids, [TRACK]);
    assert.ok(r.beforeSecond.auto > -100 && r.beforeSecond.auto < -97);
    assert.ok(r.afterSecond.auto < -147 && r.afterSecond.auto > -150);
    assert.equal(r.events.first.weight, 100); assert.equal(r.events.second.weight, 50);
    assert.deepEqual(r.history, []); assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

for (const history of [false, true]) test(`reload + Search cache reuse: history=${history} governs exclusion independently of S2`, async () => {
  const s = await harness.page();
  try {
    await setup(s.page); await seed(s.page);
    const raw = await s.page.evaluate(async ({ first, history }) => {
      await autoTrackFeedback.configure(true);
      const event = auditEvent('persisted', first);
      await OfficeSkipJournal.createStore(indexedDB, () => Date.now())('append', 'mock-public',
        { ...event, account: 'mock-public' });
      await autoTrackFeedback.record(event);
      if (history) saveHistory([{ trackId: auditTrack.id, trackName: auditTrack.name,
        artistNames: ['ADÉLA'], playedAt: new Date(first).toISOString(), source: 'spotify' }]);
      writeSearchCache('genre:"rock"', 0, [auditTrack]);
      saveCandidatePool([]);
      return localStorage.getItem(OfficeAutoTrackFeedback.localKey('mock-owner'));
    }, { first: FIRST, history });
    await s.page.reload(); await s.page.waitForFunction(() => window.ommStorageReady !== false);
    await setup(s.page, SECOND);
    const r = await s.page.evaluate(async () => {
      const cached = readSearchCache('genre:"rock"', 0);
      const acquisition = createCandidateAcquisition(auditProfiles);
      acquisition.blockProfiles = auditProfiles;
      reuseQualifyingCache(new Map(cached.map(track => [track.id,
        { track, queries: ['genre:"rock"'], savedAt: Date.now() }])), acquisition);
      return { raw: localStorage.getItem(OfficeAutoTrackFeedback.localKey('mock-owner')),
        score: autoTrackFeedback.score(auditTrack.id), cached: cached.map(t => t.id),
        journal: await OfficeSkipJournal.createStore(indexedDB, () => Date.now())('list', 'mock-public'),
        pool: loadCandidatePool().map(r => r.track.id), generated: auditGenerate() };
    });
    assert.equal(r.raw, raw); assert.ok(r.score < -97 && r.score > -100);
    assert.equal(r.journal.length, 1); assert.equal(r.journal[0].trackId, TRACK);
    assert.deepEqual(r.cached, [TRACK]);
    assert.deepEqual(r.pool, history ? [] : [TRACK]);
    assert.deepEqual(r.generated.ids, history ? [] : [TRACK]);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

for (const offset of [DAY, 14 * DAY - 1, 14 * DAY, 14 * DAY + 1]) {
  test(`actual Spotify play: history block at +${offset}ms, with independent S2 decay`, async () => {
    const s = await harness.page();
    try {
      await setup(s.page); await seed(s.page);
      const r = await s.page.evaluate(async ({ first, offset }) => {
        await autoTrackFeedback.configure(true);
        await autoTrackFeedback.record(auditEvent('penalty', first));
        saveHistory([{ trackId: auditTrack.id, trackName: auditTrack.name,
          artistNames: ['ADÉLA'], playedAt: new Date(first).toISOString(), source: 'spotify' }]);
        auditNow = first + offset;
        return { ...auditGenerate(), penalty: autoTrackFeedback.score(auditTrack.id) };
      }, { first: FIRST, offset });
      const blocked = offset <= 14 * DAY; // Existing inclusive >= cutoff comparison.
      assert.deepEqual(r.ids, blocked ? [] : [TRACK]);
      assert.equal(r.recent, blocked ? 1 : 0); assert.ok(r.penalty < 0);
      assert.deepEqual(s.errors, []);
    } finally { await s.close(); }
  });
}

test('S2 exact ID differs from the name signatures used by play history', async () => {
  const s = await harness.page();
  try {
    await setup(s.page);
    const r = await s.page.evaluate(async () => {
      await autoTrackFeedback.configure(true);
      await autoTrackFeedback.record(auditEvent('identity', Date.now()));
      const other = { ...auditTrack, id: 'differentEdition', uri: 'spotify:track:differentEdition' };
      saveHistory([{ trackId: '', trackName: auditTrack.name, artistNames: ['ADÉLA'],
        trackSignature: trackSignature(auditTrack),
        playedAt: new Date(Date.now()).toISOString(), source: 'lastfm' }]);
      const blocks = buildHistoryBlocklists();
      return { exact: autoTrackFeedback.score(auditTrack.id), other: autoTrackFeedback.score(other.id),
        ids: [...blocks.blockedTracks], signature: blocks.blockedTrackSignatures.has(trackSignature(other)) };
    });
    assert.equal(r.exact, -100); assert.equal(r.other, 0);
    assert.deepEqual(r.ids, []); assert.equal(r.signature, true);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('audit limitation: direct selector accepts a candidate qualified before a new play-history block', async () => {
  const s = await harness.page();
  try {
    await setup(s.page); await seed(s.page);
    const r = await s.page.evaluate(() => {
      const ctx = acquisitionContext(auditProfiles);
      const { eligible, stats } = eligibleGroupCandidates(auditProfiles, generationBlocklists(auditProfiles), ctx);
      saveHistory([{ trackId: auditTrack.id, playedAt: new Date(Date.now()).toISOString(), source: 'spotify' }]);
      return { stale: selectGroupPlaylist(eligible, 1, ctx, stats).tracks.map(t => t.id), fresh: auditGenerate() };
    });
    // Production generation qualifies synchronously immediately before selection.
    assert.deepEqual(r.stale, [TRACK]); assert.deepEqual(r.fresh.ids, []);
    assert.equal(r.fresh.recent, 1); assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('16 Oct generator writes the penalized track when independent play history is empty', async () => {
  const s = await harness.page();
  try {
    await setup(s.page); await seed(s.page);
    const r = await s.page.evaluate(async ({ first, second }) => {
      await autoTrackFeedback.configure(true);
      await autoTrackFeedback.record(auditEvent('generator', first));
      auditNow = second;
      playlistLength.value = '30';
      selectedProfiles = () => auditProfiles;
      getValidAccessToken = async () => 'mock-token';
      cleanupOldOfficePlaylists = async () => ({ found: 0, removed: 0 });
      refreshLastFmBeforeGeneration = async () => {};
      // No new acquisition: real generator must qualify the persisted pool.
      primeManualSeedArtists = primeProfileGenres = primeCommonGroupQueries = async () => {};
      window.auditWrites = [];
      fetch = async url => {
        if (String(url).includes('/me/player/recently-played?')) return Response.json({ items: [] });
        throw new Error('Unexpected external request in generator audit');
      };
      createPlaylist = async () => ({ id: 'mockNewPlaylist', uri: 'spotify:playlist:mockNewPlaylist',
        external_urls: { spotify: 'https://open.spotify.com/playlist/mockNewPlaylist' } });
      addItemsToPlaylist = async (_token, playlistId, uris) => { auditWrites.push({ playlistId, uris }); };
      uploadCloudStateIfChanged = async () => ({ saved: 0 });
      persistGenerationLog = async () => ({ status: 'local' });
      await generateOfficePlaylist();
      return { writes: auditWrites, history: loadHistory(),
        savedIds: loadRecentPlaylists()[0]?.tracks.map(t => t.id),
        complete: !generationInFlight, penalty: autoTrackFeedback.score(auditTrack.id) };
    }, { first: FIRST, second: SECOND });
    assert.deepEqual(r.writes, [{ playlistId: 'mockNewPlaylist', uris: [`spotify:track:${TRACK}`] }]);
    assert.deepEqual(r.savedIds, [TRACK]); assert.deepEqual(r.history, []);
    assert.equal(r.complete, true); assert.ok(r.penalty < -97 && r.penalty > -100);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
