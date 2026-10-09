import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startBrowserHarness } from './helpers/browser.mjs';
const baseline = JSON.parse(readFileSync(new URL('./fixtures/p1-baseline-v43.20.json', import.meta.url), 'utf8'));
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(run, arg) {
  const session = await harness.page();
  try { const result = await session.page.evaluate(run, arg); assert.deepEqual(session.errors, []); return result; }
  finally { await session.close(); }
}

test('indeks zachowuje pierwszy rekord wykonawcy, ostatni rekord tagów modelu i dokładne sygnatury', async () => {
  const r = await evaluate(({ sources }) => {
    const now = Date.now(), originalNow = Date.now; Date.now = () => now;
    try {
      localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([
        { artist: ' Artist ', tags: [], sources: [], savedAt: now },
        { artist: 'artist', tags: ['rock', 'jazz'], sources: ['tag'], savedAt: now },
        { artist: 'Guest', tags: ['pop'], sources: ['tag'], savedAt: now }
      ]));
      localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify([
        { artist: 'Artist', track: 'Song', tags: ['jazz'], sources: ['tag'], savedAt: now },
        { artist: 'Artist', track: 'Song', tags: ['rock'], sources: ['tag'], savedAt: now }
      ]));
      const track = { id: 'one', name: 'Song', uri: 'spotify:track:one', artists: [{ name: 'ARTIST' }, { name: 'Guest' }] };
      const snapshot = createLastFmEvidenceSnapshot();
      const oldEvidence = (0, eval)(`(${sources.lastFmEvidenceForTrack})`);
      const selected = [{ id: 'bartek', artists: [], taste: {} }];
      const ctx = buildGroupRecommendationContext(selected, [], snapshot);
      return { old: oldEvidence(track), indexed: lastFmEvidenceForTrack(track, snapshot),
        first: snapshot.artistByName.get('artist').tags, modelLast: ctx.artistPool.get('artist').tags,
        trackLast: ctx.trackPool.get('artist|song').tags, variantsFirst: ctx.acquisitionVariantArtists.get('artist').tags };
    } finally { Date.now = originalNow; }
  }, { sources: baseline.functions });
  assert.deepEqual(r.old, r.indexed);
  assert.deepEqual(r.first, []); assert.deepEqual(r.modelLast, ['rock', 'jazz']);
  assert.deepEqual(r.trackLast, ['rock']); assert.deepEqual(r.variantsFirst, []);
});

for (const people of [2, 4]) {
  test(`${people} osoby: stare i indeksowane oceny, filtry, discovery, finalne ID i diagnostyka identyczne`, async () => {
    const r = await evaluate(({ people, sources }) => {
      Math.random = () => .25;
      const now = Date.now(), originalNow = Date.now; Date.now = () => now;
      try {
        localStorage.setItem(LASTFM_USER_KEY, 'owner');
        const make = i => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}${i === 4 ? ' - Rework' : ''}`,
          artists: [{ id: `a${i}`, name: `Artist ${i}` }, ...(i === 7 ? [{ name: 'Guest', id: 'guest' }] : [])] });
        const tracks = Array.from({ length: 20 }, (_, i) => make(i));
        const rows = tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now }));
        localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(rows));
        localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(tracks.map((track, i) => ({
          artist: track.artists[0].name, tags: i === 9 ? ['classical'] : ['rock'], sources: ['tag', 'recent'], savedAt: now,
          recentCount: 99, recentObservation: { user: i === 8 ? 'other' : 'owner', observedAt: now, plays: i < 12 ? [now / 1000 - (i === 8 ? 1 : 3600)] : [] }
        }))));
        localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.slice(0, 12).map(track => ({
          artist: track.artists[0].name, track: track.name, tags: ['rock'], sources: ['tag'], savedAt: now
        }))));
        localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ [trackSignature(tracks[2])]: { value: -1, artists: ['artist 2'] },
          [trackSignature(tracks[3])]: { value: 1, artists: ['artist 3'] } }));
        localStorage.setItem(FEEDBACK_BLOCKED_ARTISTS_KEY, JSON.stringify({ 'artist 5': { name: 'Artist 5' } }));
        const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({
          id, name: profiles[id].name, artists: [], blockedArtists: ['Artist 6'], manualGenres: [],
          taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: ['Pop'], blockedGenres: ['Classical'] }
        }));
        const blocks = generationBlocklists(selected), fresh = createLastFmEvidenceSnapshot();
        const originals = [buildGroupRecommendationContext, lastFmEvidenceForTrack, trackDiagnostic];
        const run = indexed => {
          [buildGroupRecommendationContext, lastFmEvidenceForTrack, trackDiagnostic] = indexed ? originals : originals.map((fn, i) => (0, eval)(`(${sources[['buildGroupRecommendationContext', 'lastFmEvidenceForTrack', 'trackDiagnostic'][i]]})`));
          const ctx = buildGroupRecommendationContext(selected, rows, indexed ? fresh : null);
          const statics = tracks.map(track => {
            const item = groupCandidateStatic(track, ctx);
            return { id: track.id, base: item.groupBase, byUser: item.byUser, feedback: item.features.feedback,
              recognition: item.features.recognizability, discovery: item.features.discovery, evidence: [...item.features.aspectEvidence] };
          });
          const { eligible, stats } = eligibleGroupCandidates(selected, blocks, ctx, rows);
          const output = selectGroupPlaylist(eligible, 12, ctx, stats);
          const ids = sequencePlaylistForListening(output.tracks, 5).map(track => track.id);
          return { statics, eligible: eligible.map(item => item.track.id), stats, ids, satisfaction: output.satisfaction,
            discovery: output.discoveryCount, quota: output.discoveryQuota,
            diagnostics: tracks.map(track => trackDiagnostic(track, output.details.get(track.id), selected, indexed ? fresh : null)) };
        };
        try { const before = run(false), after = run(true); return { before, after }; }
        finally { [buildGroupRecommendationContext, lastFmEvidenceForTrack, trackDiagnostic] = originals; }
      } finally { Date.now = originalNow; }
    }, { people, sources: baseline.functions });
    assert.deepEqual(r.after, r.before);
    assert.ok(r.after.ids.length > 0);
    assert.ok(r.after.discovery > 0); assert.ok(r.after.discovery <= r.after.quota.max);
    assert.ok(!r.after.ids.some(id => ['t2', 't4', 't5', 't6'].includes(id)));
  });
}

test('nowy etap odświeża recentCount, konto, TTL, feedback i blokady; stary snapshot nie zmienia się', async () => {
  const r = await evaluate(() => {
    let now = Date.now(); const originalNow = Date.now; Date.now = () => now;
    try {
      const track = { id: 'one', uri: 'spotify:track:one', name: 'Song', artists: [{ name: 'Artist' }] };
      localStorage.setItem(LASTFM_USER_KEY, 'owner');
      localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([{ artist: 'Artist', tags: ['rock'], sources: ['tag', 'recent'], savedAt: now,
        recentObservation: { user: 'owner', observedAt: now, plays: [now / 1000 - LASTFM_HISTORY_WINDOW_DAYS * 86400 + 1] } }]));
      localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify([{ artist: 'Artist', track: 'Song', tags: ['rock'], savedAt: now }]));
      const first = createLastFmEvidenceSnapshot();
      now += 2000;
      const expiredRecent = createLastFmEvidenceSnapshot();
      localStorage.setItem(LASTFM_USER_KEY, 'other');
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ [trackSignature(track)]: { value: 1, artists: ['artist'] } }));
      localStorage.setItem(FEEDBACK_BLOCKED_ARTISTS_KEY, JSON.stringify({ artist: { name: 'Artist' } }));
      const changed = createLastFmEvidenceSnapshot();
      now += LASTFM_ARTIST_POOL_MAX_AGE_MS + 1;
      const expired = createLastFmEvidenceSnapshot();
      return { first: lastFmEvidenceForTrack(track, first), expiredRecent: lastFmEvidenceForTrack(track, expiredRecent),
        changed: lastFmEvidenceForTrack(track, changed), expired: lastFmEvidenceForTrack(track, expired),
        blocked: changed.feedbackState.hardBlocked.has('artist'), unchanged: first.feedbackState.hardBlocked.size === 0 && Object.keys(first.feedback).length === 0 };
    } finally { Date.now = originalNow; }
  });
  assert.equal(r.first.recentCount, 1); assert.equal(r.expiredRecent.recentCount, 0);
  assert.equal(r.changed.recentCount, 0); assert.equal(r.changed.positiveFeedback, true);
  assert.equal(r.expired.exact, false); assert.equal(r.expired.maxTags, 0);
  assert.equal(r.blocked, true); assert.equal(r.unchanged, true);
});

test('kwalifikacja i 120 diagnostyk: po snapshotcie zero kolejnych odczytów baz Last.fm', async () => {
  const r = await evaluate(() => {
    const now = Date.now(), tracks = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ name: `Artist ${i}` }] }));
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(tracks.map(t => ({ artist: t.artists[0].name, tags: ['rock'], sources: ['tag'], savedAt: now }))));
    localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.map(t => ({ artist: t.artists[0].name, track: t.name, tags: ['rock'], savedAt: now }))));
    const selected = [{ id: 'bartek', name: 'Bartek', artists: [], taste: { hasSurvey: true, likedGenres: ['Rock'] } }];
    const original = Storage.prototype.getItem, counts = { artists: 0, tracks: 0 };
    Storage.prototype.getItem = function (key) { if (key === LASTFM_ARTIST_POOL_KEY) counts.artists++; if (key === LASTFM_TRACK_POOL_KEY) counts.tracks++; return original.call(this, key); };
    try {
      const snapshot = createLastFmEvidenceSnapshot();
      const rows = tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now }));
      const ctx = buildGroupRecommendationContext(selected, rows, snapshot);
      eligibleGroupCandidates(selected, generationBlocklists(selected), ctx, rows);
      for (let i = 0; i < 120; i++) trackDiagnostic(tracks[i % 60], null, selected, snapshot);
      return counts;
    } finally { Storage.prototype.getItem = original; }
  });
  assert.deepEqual(r, { artists: 1, tracks: 1 });
});

test('puste i uszkodzone pule oraz brak danych wykonawcy zachowują legacy fallback', async () => {
  const r = await evaluate(({ source }) => {
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, '{broken'); localStorage.setItem(LASTFM_TRACK_POOL_KEY, 'null');
    const old = (0, eval)(`(${source})`), snapshot = createLastFmEvidenceSnapshot();
    return [null, { name: 'Unknown', artists: [] }, { name: 'Unknown', artists: [{ name: 'Missing' }] }].map(track => ({
      before: old(track), after: lastFmEvidenceForTrack(track, snapshot), pass: recognizabilityPass(track, snapshot)
    }));
  }, { source: baseline.functions.lastFmEvidenceForTrack });
  for (const row of r) { assert.deepEqual(row.after, row.before); assert.equal(row.pass, false); }
});

test('indeks wariantów zachowuje ochronę klasyki, współwykonawców i pierwszego homonima', async () => {
  const r = await evaluate(() => {
    const now = Date.now(), results = [];
    const track = { name: 'Animal', album: { name: 'Drastic Symphonies' }, artists: [{ name: 'Def Leppard' }, { name: 'Royal Philharmonic Orchestra' }] };
    for (const tags of [['hard rock'], ['classical'], []]) {
      localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([
        { artist: 'Def Leppard', tags, savedAt: now },
        { artist: 'def leppard', tags: ['rock'], savedAt: now }
      ]));
      const snapshot = createLastFmEvidenceSnapshot();
      results.push({ before: looksLikeUnwantedVariant(track), after: looksLikeUnwantedVariant(track, snapshot.artistByName),
        classical: looksLikeUnwantedVariant({ ...track, name: 'Symphony No. 5 (Orchestra)' }, snapshot.artistByName),
        original: looksLikeUnwantedVariant({ ...track, artists: [track.artists[0]], album: { name: 'Hysteria' } }, snapshot.artistByName) });
    }
    return results;
  });
  assert.deepEqual(r.map(row => row.before), [true, false, false]);
  for (const row of r) { assert.equal(row.before, row.after); assert.equal(row.classical, false); assert.equal(row.original, false); }
});

test('generowanie tworzy nowy snapshot po pozyskiwaniu i po await zapisu; kolejny przebieg nie używa starych danych', async () => {
  const r = await evaluate(async () => {
    Math.random = () => .25;
    const now = Date.now(), tracks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ name: `Artist ${i}` }] }));
    const seed = () => {
      localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now }))));
      localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(tracks.map(t => ({ artist: t.artists[0].name, tags: ['rock'], sources: ['tag'], savedAt: now }))));
      localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.map(t => ({ artist: t.artists[0].name, track: t.name, tags: ['rock'], savedAt: now }))));
    };
    const selected = ['bartek', 'asia'].map(id => ({ id, name: profiles[id].name, artists: [], genres: ['rock'], manualGenres: [], blockedArtists: [], taste: { hasSurvey: true, likedGenres: ['Rock'] } }));
    getValidAccessToken = async () => 'mock'; selectedProfiles = () => selected;
    cleanupOldOfficePlaylists = async () => ({}); refreshLastFmBeforeGeneration = async () => {}; syncSpotifyRecentHistory = async () => {};
    primeManualSeedArtists = async () => {}; primeProfileGenres = async () => {};
    let generation = 0, snapshots = 0, diagnosticCalls = 0;
    const originalDiagnostic = trackDiagnostic;
    trackDiagnostic = (...args) => { diagnosticCalls++; return originalDiagnostic(...args); };
    const originalSnapshot = createLastFmEvidenceSnapshot;
    createLastFmEvidenceSnapshot = () => { snapshots++; return originalSnapshot(); };
    primeCommonGroupQueries = async () => { await Promise.resolve(); localStorage.setItem(FEEDBACK_KEY, JSON.stringify({
      [trackSignature(tracks[generation])]: { value: -1, artists: [`artist ${generation}`] }
    })); };
    createPlaylist = async () => ({ id: `mock${generation}`, name: 'Mock', uri: `spotify:playlist:mock${generation}` });
    const written = [];
    addItemsToPlaylist = async (_token, _id, uris) => {
      written.push(uris);
      await Promise.resolve();
      // Feedback and LF metadata changed during a real await before diagnostics.
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ [trackSignature(tracks[5])]: { value: 1, artists: ['artist 5'] } }));
      localStorage.setItem(LASTFM_TRACK_POOL_KEY, '[]'); localStorage.setItem(LASTFM_ARTIST_POOL_KEY, '[]');
    };
    uploadCloudStateIfChanged = async () => ({});
    const outputs = [];
    for (generation = 0; generation < 2; generation++) {
      seed(); await generateOfficePlaylist();
      const snapshot = loadRecentPlaylists()[0];
      outputs.push({ ids: snapshot.tracks.map(t => t.id), diagnostic: snapshot.tracks.find(t => t.id === 't5').diagnostic,
        text: playlistResult.textContent, json: JSON.stringify(snapshot), written: written.at(-1) });
    }
    return { outputs, snapshots, diagnosticCalls };
  });
  assert.equal(r.snapshots, 4);
  assert.equal(r.diagnosticCalls, 10);
  for (const [i, row] of r.outputs.entries()) {
    assert.ok(!row.ids.includes(`t${i}`)); assert.equal(row.ids.length, 5);
    assert.equal(row.written.length, row.ids.length);
    assert.match(row.diagnostic, /feedback \+108/); assert.ok(!row.diagnostic.includes('Last.fm:'));
    assert.ok(row.text.includes(row.diagnostic)); assert.ok(!row.json.includes('artistByName'));
  }
});
