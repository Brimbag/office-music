import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startBrowserHarness } from './helpers/browser.mjs';
const baseline = JSON.parse(readFileSync(new URL('./fixtures/p2-baseline-v43.21.json', import.meta.url), 'utf8'));
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(fn, arg) {
  const session = await harness.page();
  try { const result = await session.page.evaluate(fn, arg); assert.deepEqual(session.errors, []); return result; }
  finally { await session.close(); }
}
for (const people of [2, 4]) {
  test(`${people} osoby: zapis i widok zgodne z P.1, diagnostyka obliczona tylko raz; odtworzenie i głosowanie działają`, async () => {
    const result = await evaluate(({ people, sources }) => {
      const now = Date.now();
      const tracks = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`,
        artists: [{ id: `a${i}`, name: `Artist ${i}` }, ...(i === 3 ? [{ id: 'guest', name: 'Guest' }] : [])] }));
      const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, name: profiles[id].name, artists: [], taste: {} }));
      localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(tracks.map((track, i) => ({ track, queries: [`artist:${i}`, 'genre:rock'], savedAt: now }))));
      localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(tracks.slice(0, 6).map(track => ({ artist: track.artists[0].name, tags: ['rock'], sources: ['tag'], savedAt: now }))));
      localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.slice(0, 3).map(track => ({ artist: track.artists[0].name, track: track.name, tags: ['rock'], savedAt: now }))));
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ [trackSignature(tracks[0])]: { value: 1, artists: ['artist 0'] },
        [trackSignature(tracks[1])]: { value: -1, artists: ['artist 1'] } }));
      const groupResult = { details: new Map(tracks.map((track, i) => [track.id, {
        byUser: Object.fromEntries(selected.map((profile, j) => [profile.id, 35 + i + j])), groupBase: 45 + i,
        leastMiseryPenalty: i / 2, fairness: i, xquad: 3, mmr: 2, fallback: i === 11, isPolish: i === 4, polishBoost: 4
      }])) };
      const playlist = { id: 'mock', name: 'Mock', uri: 'spotify:playlist:mock' };
      const evidence = createLastFmEvidenceSnapshot();
      const oldSave = (0, eval)(`(${sources.saveRecentPlaylistSnapshot})`);
      const oldRender = (0, eval)(`(${sources.renderPlaylistResult})`);
      const original = trackDiagnostic; let calls = 0;
      trackDiagnostic = (...args) => { calls++; return original(...args); };
      const ui = () => [...playlistResult.querySelectorAll('.result-list > li')].map(row => row.querySelector('.track-meta').textContent);
      const oldSnapshot = oldSave(playlist, tracks, selected, 12, groupResult, evidence);
      oldRender(playlist, tracks, selected, [], 12, null, groupResult, evidence);
      const oldUi = ui(), oldCalls = calls; calls = 0;
      const diagnostics = buildPlaylistDiagnostics(tracks, selected, groupResult, evidence);
      const newSnapshot = saveRecentPlaylistSnapshot(playlist, tracks, selected, 12, groupResult, evidence, diagnostics);
      renderPlaylistResult(playlist, tracks, selected, [], 12, null, groupResult, evidence, diagnostics);
      const newUi = ui(), newCalls = calls;
      playlistResult.querySelectorAll('.result-list > li')[2].querySelector('.vote-btn').click();
      const vote = trackFeedbackValue(tracks[2]);
      trackDiagnostic = () => { throw new Error('stored diagnostics must not be recalculated'); };
      renderStoredPlaylistSnapshot(loadRecentPlaylists()[0]);
      const storedUi = ui(); trackDiagnostic = original;
      return { old: oldSnapshot.tracks, current: newSnapshot.tracks, oldUi, newUi, storedUi, oldCalls, newCalls, vote,
        keys: Object.keys(newSnapshot).sort(), mapSize: diagnostics.size };
    }, { people, sources: baseline.functions });
    assert.deepEqual(result.current, result.old);
    assert.deepEqual(result.newUi, result.oldUi); assert.deepEqual(result.storedUi, result.newUi);
    assert.equal(result.oldCalls, 24); assert.equal(result.newCalls, 12); assert.equal(result.mapSize, 12);
    assert.equal(result.vote, 1); assert.ok(!result.keys.includes('diagnostics'));
  });
}
test('pamięć lokalna rozróżnia brak ID i homonimy; powtórzony obiekt oraz pusty tekst nie powodują ponownego obliczenia', async () => {
  const result = await evaluate(() => {
    const one = { name: 'Song', artists: [{ id: 'first', name: 'Days of the New' }] };
    const two = { name: 'Song', artists: [{ id: 'second', name: 'Days of the New' }] };
    const tracks = [one, two, one]; let calls = 0;
    trackDiagnostic = track => { calls++; return track === one ? '' : 'second artist'; };
    const diagnostics = buildPlaylistDiagnostics(tracks, [], null, null);
    const snapshot = saveRecentPlaylistSnapshot({ id: 'edge' }, tracks, [], 3, null, null, diagnostics);
    renderPlaylistResult({ id: 'edge' }, tracks, [], [], 3, null, null, null, diagnostics);
    return { calls, size: diagnostics.size, saved: snapshot.tracks.map(t => t.diagnostic),
      visible: [...playlistResult.querySelectorAll('.result-list > li .track-meta')].filter((_, i) => i % 2 === 0).map(el => el.textContent),
      empty: buildPlaylistDiagnostics([], [], null, null).size };
  });
  assert.equal(result.calls, 2); assert.equal(result.size, 2); assert.equal(result.empty, 0);
  assert.deepEqual(result.saved, ['', 'second artist', '']); assert.deepEqual(result.visible, result.saved);
});
test('wywołania bez mapy oraz niepełna mapa zachowują świeży fallback, bez cache pomiędzy wywołaniami', async () => {
  const result = await evaluate(() => {
    const tracks = [{ id: 'one', name: 'One', artists: [] }, { id: 'two', name: 'Two', artists: [] }];
    let revision = 1, calls = 0;
    trackDiagnostic = t => { calls++; return `${t.id}/${revision}`; };
    const playlist = { id: 'fallback' };
    const a = saveRecentPlaylistSnapshot(playlist, tracks, [], 2, null).tracks.map(t => t.diagnostic);
    revision = 2;
    renderPlaylistResult(playlist, tracks, [], [], 2);
    const b = [...playlistResult.querySelectorAll('.result-list > li')].map(li => li.querySelector('.track-meta').textContent);
    const partial = new Map([[tracks[0], 'prepared']]); revision = 3;
    const c = saveRecentPlaylistSnapshot(playlist, tracks, [], 2, null, null, partial).tracks.map(t => t.diagnostic);
    const fresh = buildPlaylistDiagnostics(tracks, [], null, null);
    return { a, b, c, fresh: [...fresh.values()], calls };
  });
  assert.deepEqual(result.a, ['one/1', 'two/1']); assert.deepEqual(result.b, ['one/2', 'two/2']);
  assert.deepEqual(result.c, ['prepared', 'two/3']); assert.deepEqual(result.fresh, ['one/3', 'two/3']); assert.equal(result.calls, 7);
});
