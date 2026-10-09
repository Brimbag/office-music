import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

async function evaluate(run, arg) {
  const session = await harness.page();
  try {
    const result = await session.page.evaluate(run, arg);
    assert.deepEqual(session.errors, []);
    return result;
  } finally { await session.close(); }
}

for (const penalty of [-39, -40, -41, -55]) {
  test(`granica kary wykonawcy ${penalty}: wszystkie ścieżki selektora`, async () => {
    const result = await evaluate(penalty => {
      // Imported numeric feedback allows an exact threshold fixture;
      // the UI's usual single downvote is covered separately as -55.
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ prior: { value: penalty / 55, artists: ['artist'] } }));
      const ctx = buildGroupRecommendationContext([{ id: 'bartek', artists: [], taste: {} }]);
      const track = { id: 'candidate', uri: 'spotify:track:candidate', name: 'Candidate', artists: [{ name: 'Artist' }] };
      const item = groupCandidateStatic(track, ctx);
      item.features.discovery = false;
      item.minScore = 60;
      item.byUser.bartek.score = 60;
      const paths = [60, 36].map(base => {
        item.groupBase = base;
        return selectGroupPlaylist([item], 1, ctx, newRejectionStats(1)).tracks.length;
      });
      return { score: artistFeedbackScore(feedbackArtistStats().get('artist')), paths };
    }, penalty);
    assert.equal(result.score, penalty);
    assert.deepEqual(result.paths, penalty <= -40 ? [0, 0] : [1, 1]);
  });
}

test('dodatnia ocena utworu i współwykonawcy nie maskuje kary, brak przenoszenia i zapisu blokad', async () => {
  const result = await evaluate(() => {
    const track = { id: 'duet', uri: 'spotify:track:duet', name: 'Duet', artists: [{ name: 'Bad' }, { name: 'Good' }] };
    const feedback = {
      bad1: { value: -1, artists: ['bad'] }, bad2: { value: -1, artists: ['bad'] },
      [trackSignature(track)]: { value: 1, artists: ['bad', 'good'] }
    };
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(feedback));
    const before = exportedStorageState();
    const ctx = buildGroupRecommendationContext([{ id: 'bartek', artists: [], taste: {} }]);
    const item = groupCandidateStatic(track, ctx);
    item.groupBase = 100; item.minScore = 90; item.features.discovery = false;
    const selection = selectGroupPlaylist([item], 1, ctx, newRejectionStats(1));
    const solo = { ...track, id: 'solo', name: 'Solo', artists: [{ name: 'Good' }] };
    const swapped = { ...track, artists: [...track.artists].reverse() };
    const stats = feedbackArtistStats();
    return {
      combined: feedbackScore(track), bad: artistFeedbackScore(stats.get('bad')),
      good: artistFeedbackScore(stats.get('good')), selected: selection.tracks.length,
      blocked: hasStrongNegativeArtistFeedback(track), swapped: hasStrongNegativeArtistFeedback(swapped),
      soloBlocked: hasStrongNegativeArtistFeedback(solo), unchanged: JSON.stringify(before) === JSON.stringify(exportedStorageState()),
      hardBlocks: loadFeedbackBlockedArtists(), count: selection.rejectionStats.strongNegativeArtistFeedback
    };
  });
  assert.equal(result.combined, 53);
  assert.equal(result.bad, -55); assert.equal(result.good, 18);
  assert.equal(result.selected, 0); assert.equal(result.count, 1);
  assert.equal(result.blocked, true); assert.equal(result.swapped, true);
  assert.equal(result.soloBlocked, false); assert.equal(result.unchanged, true);
  assert.deepEqual(result.hardBlocks, {});
});

test('filtr puli odrzuca duet, ale pozostawia solo współwykonawcy; usunięcie feedbacku przywraca wykonawcę', async () => {
  const result = await evaluate(() => {
    const now = Date.now();
    const tracks = ['bad', 'duet', 'good'].map(id => ({
      id, uri: `spotify:track:${id}`, name: `Song ${id}`,
      artists: (id === 'duet' ? ['Bad', 'Good'] : [id === 'bad' ? 'Bad' : 'Good']).map(name => ({ name })), album: { name: 'Album' }
    }));
    saveCandidatePool(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now })));
    localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.map(track => ({
      artist: track.artists[0].name, track: track.name, tags: ['rock'], sources: ['tag'], savedAt: now
    }))));
    const selected = [{ id: 'bartek', artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'] } }];
    const empty = () => new Set();
    const lists = { blockedTracks: empty(), blockedTrackSignatures: empty(), blockedArtists: empty(), historyBlockedNames: empty(), explicitBlockedNames: empty(), feedbackBlockedNames: empty() };
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ prior: { value: -1, artists: ['bad'] } }));
    const first = eligibleGroupCandidates(selected, lists, buildGroupRecommendationContext(selected));
    localStorage.removeItem(FEEDBACK_KEY);
    const restored = eligibleGroupCandidates(selected, lists, buildGroupRecommendationContext(selected));
    return { first: first.eligible.map(item => item.track.id), count: first.stats.strongNegativeArtistFeedback, restored: restored.eligible.map(item => item.track.id) };
  });
  assert.deepEqual(result.first, ['good']); assert.equal(result.count, 2);
  assert.deepEqual(result.restored, ['bad', 'duet', 'good']);
});

test('starszy dobór z zapytań wyklucza karę z cache i nowych stron, zachowuje solo partnera', async () => {
  const result = await evaluate(async () => {
    const track = (id, names) => ({ id, uri: `spotify:track:${id}`, name: id, artists: names.map(name => ({ name })), album: { name: 'Album' } });
    const cached = [track('bad-cache', ['Bad']), track('good-cache', ['Good'])];
    const fresh = [track('bad-fresh', ['Good', 'Bad']), track('safe-fresh', ['Other'])];
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ prior: { value: -1, artists: ['bad'] } }));
    saveCandidatePool(cached.map(track => ({ track, queries: ['genre:"rock"'], savedAt: Date.now() })));
    const original = searchTracks;
    let calls = 0;
    searchTracks = async () => { calls++; return fresh; };
    try {
      const empty = () => new Set();
      const result = await collectFromQueries('test', ['genre:"rock"'], 2, empty(), empty(), new Map(), empty(), empty(), empty(), empty(), { recognizabilityOverride: 'low' });
      return { ids: result.map(track => track.id), calls };
    } finally { searchTracks = original; }
  });
  assert.deepEqual(result.ids, ['good-cache', 'safe-fresh']); assert.equal(result.calls, 1);
});

test('rozluźnienie sąsiedztwa w normalnej selekcji i fallbacku nie omija wykluczenia', async () => {
  const result = await evaluate(() => {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ prior: { value: -1, artists: ['bad'] } }));
    return [60, 36].map(secondBase => {
      const ctx = buildGroupRecommendationContext([{ id: 'bartek', artists: [], taste: {} }]);
      const rows = ['first', 'second', 'blocked'].map(id => {
        const track = { id, uri: `spotify:track:${id}`, name: id, artists: (id === 'blocked' ? ['Good', 'Bad'] : ['Good']).map(name => ({ name })) };
        const item = groupCandidateStatic(track, ctx);
        item.groupBase = id === 'blocked' ? 100 : id === 'first' ? 90 : secondBase;
        item.features.discovery = false; item.minScore = 60; item.byUser.bartek.score = 60;
        return item;
      });
      const selection = selectGroupPlaylist(rows, 3, ctx, newRejectionStats(3));
      return { ids: selection.tracks.map(track => track.id), rejected: selection.rejectionStats.strongNegativeArtistFeedback, fallback: selection.rejectionStats.fallbackSelections };
    });
  });
  assert.deepEqual(result, [
    { ids: ['first', 'second'], rejected: 1, fallback: 0 },
    { ids: ['first', 'second'], rejected: 1, fallback: 1 }
  ]);
});

test('punktacja zachowuje dodatnie/ujemne wagi; puste i nieznane nazwiska nie są karane', async () => {
  const result = await evaluate(() => ({
    scores: [undefined, { ups: 1, downs: 0, balance: 1 }, { ups: 2, downs: 0, balance: 2 }, { ups: 0, downs: 1, balance: -1 }, { ups: 0, downs: 2, balance: -2 }].map(artistFeedbackScore),
    unknown: [{}, { artists: [{}] }, { artists: [{ name: 'Unknown' }] }].map(track => hasStrongNegativeArtistFeedback(track)),
    normalized: hasStrongNegativeArtistFeedback({ artists: [{ name: '  BAD  ' }] }, new Map([['bad', { ups: 0, downs: 1, balance: -1 }]]))
  }));
  assert.deepEqual(result.scores, [0, 18, 66, -55, -250]);
  assert.deepEqual(result.unknown, [false, false, false]); assert.equal(result.normalized, true);
});

for (const people of [2, 4]) {
  test(`wpływ na długość dla ${people} profili: skrócenie bez zamienników i uzupełnienie bezpiecznymi`, async () => {
    const result = await evaluate(people => {
      Math.random = () => 0.25;
      const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({
        id, artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] }
      }));
      const tracks = Array.from({ length: 20 }, (_, i) => ({
        id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`,
        artists: [{ name: `Artist ${Math.floor(i / 2)}` }], album: { name: 'Album' }
      }));
      const now = Date.now();
      localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.map(track => ({
        artist: track.artists[0].name, track: track.name, tags: ['rock'], sources: ['tag'], savedAt: now
      }))));
      const empty = () => new Set();
      const lists = { blockedTracks: empty(), blockedTrackSignatures: empty(), blockedArtists: empty(), historyBlockedNames: empty(), explicitBlockedNames: empty(), feedbackBlockedNames: empty() };
      function generate(pool) {
        saveCandidatePool(pool.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now })));
        const ctx = buildGroupRecommendationContext(selected);
        const { eligible, stats } = eligibleGroupCandidates(selected, lists, ctx);
        const result = selectGroupPlaylist(eligible, 16, ctx, stats);
        return { length: result.tracks.length, ids: result.tracks.map(track => track.id), averages: Object.values(result.satisfaction).map(row => row.average), blocked: stats.strongNegativeArtistFeedback };
      }
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ prior6: { value: -1, artists: ['artist 6'] }, prior7: { value: -1, artists: ['artist 7'] } }));
      return { shortage: generate(tracks.slice(0, 16)), replacements: generate(tracks) };
    }, people);
    assert.equal(result.shortage.length, 12); assert.equal(result.replacements.length, 16);
    for (const row of Object.values(result)) {
      assert.equal(row.blocked, 4);
      assert.ok(row.ids.every(id => !['t12', 't13', 't14', 't15'].includes(id)));
      // Same fixture on main scores 56.04; exclusion must not lower the
      // individual quality scores or compensate by changing thresholds.
      assert.ok(row.averages.every(score => Math.abs(score - 56.04) < 1e-9));
    }
  });
}
