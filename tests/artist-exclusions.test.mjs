import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
const A = '1111111111111111111111', B = '2222222222222222222222', C = '3333333333333333333333';
async function evaluate(run, arg) {
  const session = await harness.page();
  try { const result = await session.page.evaluate(run, arg); assert.deepEqual(session.errors, []); return result; }
  finally { await session.close(); }
}

for (const reason of ['dislike', 'wrong_artist']) test(`${reason}: dwa ID Days of the New, bez przenoszenia preferencji i bez zmiany playlist`, async () => {
  const result = await evaluate(({ A, B, reason }) => {
    const tracks = [A, B].map(id => ({ id: `track-${id}`, uri: `spotify:track:track-${id}`, name: 'Touch, Peel and Stand', artists: [{ id, name: 'Days of the New' }] }));
    const before = exportedStorageState();
    setArtistExclusion(tracks[0], A, reason);
    const after = exportedStorageState(); delete after[OfficeArtistExclusions.KEY];
    return { excluded: tracks.map(trackHasArtistExclusion), feedback: tracks.map(feedbackScore), unchanged: JSON.stringify(before) === JSON.stringify(after), record: artistExclusionStatus(A).entries[0], legacyBlock: localStorage.getItem(FEEDBACK_BLOCKED_ARTISTS_KEY), legacyFeedback: localStorage.getItem(FEEDBACK_KEY) };
  }, { A, B, reason });
  assert.deepEqual(result.excluded, [true, false]); assert.deepEqual(result.feedback, [0, 0]); assert.equal(result.unchanged, true);
  assert.equal(result.record.artistId, A); assert.equal(result.record.reason, reason); assert.equal(result.record.trackId, `track-${A}`);
  assert.equal(result.record.artists[0].id, A); assert.equal(result.legacyBlock, null); assert.equal(result.legacyFeedback, null);
});

test('współwykonawca: jego ID blokuje duet w każdej kolejności, nie blokuje homonima ani solo partnera', async () => {
  const result = await evaluate(({ A, B, C }) => {
    const a = { id: A, name: 'Days of the New' }, b = { id: B, name: 'Days of the New' }, c = { id: C, name: 'Partner' };
    const duet = { id: 'duet', name: 'Song', artists: [c, a] };
    setArtistExclusion(duet, A, 'wrong_artist');
    return [duet, { ...duet, artists: [a, c] }, { ...duet, artists: [c] }, { ...duet, artists: [b] }].map(trackHasArtistExclusion);
  }, { A, B, C });
  assert.deepEqual(result, [true, true, false, false]);
});

test('cache, nowe strony, normalna selekcja i fallback respektują blokadę ID bez zmiany progów', async () => {
  const result = await evaluate(async ({ A, B, C }) => {
    const make = (id, artists) => ({ id, uri: `spotify:track:${id}`, name: id, artists: artists.map(id => ({ id, name: id === C ? 'Partner' : 'Days of the New' })) });
    const bad = make('bad', [A]), good = make('good', [B]), duet = make('duet', [C, A]), solo = make('solo', [C]);
    setArtistExclusion(bad, A, 'dislike');
    saveCandidatePool([bad, good].map(track => ({ track, queries: ['genre:"rock"'], savedAt: Date.now() })));
    const original = searchTracks; searchTracks = async () => [duet, solo];
    const empty = () => new Set();
    let collected;
    try { collected = await collectFromQueries('test', ['genre:"rock"'], 2, empty(), empty(), new Map(), empty(), empty(), empty(), empty(), { recognizabilityOverride: 'low' }); }
    finally { searchTracks = original; }
    const paths = [60, 36].map(base => {
      const ctx = buildGroupRecommendationContext([{ id: 'bartek', artists: [], taste: {} }]);
      const items = [bad, good, duet, solo].map(track => {
        const item = groupCandidateStatic(track, ctx); item.groupBase = base; item.minScore = 60; item.byUser.bartek.score = 60; item.features.discovery = false; return item;
      });
      const selection = selectGroupPlaylist(items, 4, ctx, newRejectionStats(4));
      return { ids: selection.tracks.map(t => t.id).sort(), excluded: selection.rejectionStats.artistIdExcluded };
    });
    return { collected: collected.map(t => t.id).sort(), paths };
  }, { A, B, C });
  assert.deepEqual(result.collected, ['good', 'solo']);
  assert.deepEqual(result.paths, [{ ids: ['good', 'solo'], excluded: 2 }, { ids: ['good', 'solo'], excluded: 2 }]);
});

for (const people of [2, 4]) test(`${people} profile: bazowe dane Last.fm działają bez migracji, brak zamienników skraca wynik tylko o blokowane ID`, async t => {
  const result = await evaluate(({ people, A }) => {
    Math.random = () => 0.25;
    const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }));
    const tracks = Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ id: i < 2 ? A : String(Math.floor(i / 2) + 2).repeat(22), name: `Artist ${Math.floor(i / 2)}` }], album: { name: 'Album' } }));
    const now = Date.now();
    localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.map(track => ({ artist: track.artists[0].name, track: track.name, tags: ['rock'], sources: ['tag'], savedAt: now }))));
    const oldState = exportedStorageState();
    function generate(pool) {
      saveCandidatePool(pool.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now })));
      const ctx = buildGroupRecommendationContext(selected), empty = () => new Set();
      const lists = { blockedTracks: empty(), blockedTrackSignatures: empty(), blockedArtists: empty(), historyBlockedNames: empty(), explicitBlockedNames: empty(), feedbackBlockedNames: empty() };
      const { eligible, stats } = eligibleGroupCandidates(selected, lists, ctx), output = selectGroupPlaylist(eligible, 12, ctx, stats);
      return { length: output.tracks.length, ids: output.tracks.map(t => t.id), excluded: stats.artistIdExcluded, averages: Object.values(output.satisfaction).map(r => r.average) };
    }
    const baseline = generate(tracks.slice(0, 12));
    setArtistExclusion(tracks[0], A, 'wrong_artist');
    const shortage = generate(tracks.slice(0, 12)), replacements = generate(tracks);
    return { baseline, shortage, replacements, lastfmUntouched: localStorage.getItem(LASTFM_TRACK_POOL_KEY) === oldState[LASTFM_TRACK_POOL_KEY] };
  }, { people, A });
  assert.equal(result.baseline.length, 12); assert.equal(result.shortage.length, 10); assert.equal(result.replacements.length, 12); assert.equal(result.lastfmUntouched, true);
  for (const row of [result.shortage, result.replacements]) {
    assert.equal(row.excluded, 2); assert.ok(row.ids.every(id => !['t0', 't1'].includes(id)));
    assert.ok(row.averages.every((score, i) => Math.abs(score - result.baseline.averages[i]) < 1e-9));
  }
  t.diagnostic(JSON.stringify({ people, baseline: result.baseline.length, shortage: result.shortage.length, replacements: result.replacements.length, averages: result.baseline.averages }));
});

test('odwołanie jest trwałe; dawna kopia nie odtwarza blokady', async () => {
  const result = await evaluate(({ A }) => {
    const track = { id: 'a', name: 'Song', artists: [{ id: A, name: 'Days of the New' }] };
    setArtistExclusion(track, A, 'wrong_artist'); const old = localStorage.getItem(OfficeArtistExclusions.KEY);
    setArtistExclusion(track, A, null);
    applyCloudStateWithMerge({ [OfficeArtistExclusions.KEY]: old });
    return { blocked: trackHasArtistExclusion(track), events: loadArtistExclusions().artists[A].length };
  }, { A });
  assert.deepEqual(result, { blocked: false, events: 2 });
});

test('konkurencyjne decyzje dwóch przeglądarek: blokada pozostaje do jawnego rozstrzygnięcia, merge idempotentny', async () => {
  const result = await evaluate(({ A }) => {
    const api = OfficeArtistExclusions;
    const value = { artistId: A, name: 'Days of the New', reason: 'wrong_artist', trackId: 'a', trackName: 'Song', artists: [{ id: A, name: 'Days of the New' }], source: 'playlist_block', updatedAt: new Date().toISOString() };
    const base = api.decide(null, A, value, 'base');
    const a = api.decide(base, A, null, 'revoke');
    const b = api.decide(base, A, { ...value, reason: 'dislike' }, 'block');
    const merged = api.merge(a, b), resolved = api.decide(merged, A, null, 'resolve');
    return { status: api.status(merged, A), final: api.status(api.merge(resolved, b), A), commutative: JSON.stringify(merged) === JSON.stringify(api.merge(b, a)), idempotent: JSON.stringify(merged) === JSON.stringify(api.merge(merged, merged)) };
  }, { A });
  assert.equal(result.status.blocked, true); assert.equal(result.status.conflict, true); assert.equal(result.final.blocked, false); assert.equal(result.final.conflict, false); assert.equal(result.commutative, true); assert.equal(result.idempotent, true);
});

test('brak ID, obcy współwykonawca i nieznany powód nie zapisują niczego', async () => {
  const result = await evaluate(({ A, B }) => {
    const errors = [];
    for (const [track, id, reason] of [[{ artists: [{ name: 'Days of the New' }] }, A, 'dislike'], [{ artists: [{ id: A, name: 'Days of the New' }] }, B, 'wrong_artist'], [{ artists: [{ id: A, name: 'Days of the New' }] }, A, 'unknown']]) {
      try { setArtistExclusion(track, id, reason); } catch (e) { errors.push(e.message); }
    }
    return { errors, state: localStorage.getItem(OfficeArtistExclusions.KEY) };
  }, { A, B });
  assert.equal(result.errors.length, 3); assert.equal(result.state, null);
});

test('quota zachowuje stary dziennik i preferencje; uszkodzony dziennik nie pozwala ominąć blokady', async () => {
  const result = await evaluate(({ A, B }) => {
    const track = { id: 'a', name: 'Song', artists: [{ id: A, name: 'Days of the New' }, { id: B, name: 'Partner' }] };
    setArtistExclusion(track, A, 'dislike'); const before = exportedStorageState(), original = Storage.prototype.setItem;
    let error = '';
    Storage.prototype.setItem = function(key, value) { if (key === OfficeArtistExclusions.KEY) throw new DOMException('Full', 'QuotaExceededError'); return original.call(this, key, value); };
    try { setArtistExclusion(track, B, 'wrong_artist'); } catch (e) { error = e.name; }
    finally { Storage.prototype.setItem = original; }
    const unchanged = JSON.stringify(before) === JSON.stringify(exportedStorageState());
    localStorage.setItem(OfficeArtistExclusions.KEY, '{broken');
    let corrupt = false; try { trackHasArtistExclusion(track); } catch { corrupt = true; }
    return { error, unchanged, corrupt };
  }, { A, B });
  assert.deepEqual(result, { error: 'QuotaExceededError', unchanged: true, corrupt: true });
});

test('dialog: anulowanie/Escape nie zapisuje, duet wybiera ID, wrong_artist pokazuje niepotwierdzony katalog i pozwala odwołać', async () => {
  const session = await harness.page();
  try {
    await session.page.evaluate(({ A, B, C }) => {
      const track = { id: 'duet', uri: 'spotify:track:duet', name: 'Song', artists: [{ id: C, name: 'Partner' }, { id: A, name: 'Days of the New' }] };
      const good = { ...track, id: 'other', uri: 'spotify:track:other', artists: [{ id: B, name: 'Days of the New' }] };
      saveCandidatePool([{ track: good, queries: [], savedAt: Date.now() }]);
      document.getElementById('playlistBox').style.display = 'block';
      document.getElementById('playlistResult').append(buildRatedTrackList([track]));
    }, { A, B, C });
    const block = session.page.locator('#playlistResult').getByRole('button', { name: '🚫', exact: true });
    await block.click(); await session.page.getByRole('button', { name: 'Anuluj', exact: true }).click();
    assert.equal(await session.page.evaluate(() => localStorage.getItem(OfficeArtistExclusions.KEY)), null);
    await block.click(); await session.page.keyboard.press('Escape');
    assert.equal(await session.page.evaluate(() => localStorage.getItem(OfficeArtistExclusions.KEY)), null);
    await block.click(); await session.page.locator('#artistExclusionArtist').selectOption(A);
    assert.equal(await session.page.locator('#artistExclusionLink').getAttribute('href'), `https://open.spotify.com/artist/${A}`);
    await session.page.getByRole('button', { name: 'Nie ten wykonawca', exact: true }).click();
    assert.match(await session.page.locator('#artistExclusionCandidates').textContent(), new RegExp(B));
    const statuses = await session.page.evaluate(({ A, B, C }) => [A, B, C].map(id => artistExclusionStatus(id).blocked), { A, B, C });
    assert.deepEqual(statuses, [true, false, false]);
    assert.match(await session.page.locator('#playlistResult').textContent(), /nie ten wykonawca/);
    await session.page.getByRole('button', { name: 'Odwołaj blokadę', exact: true }).click();
    assert.equal(await session.page.evaluate(A => artistExclusionStatus(A).blocked, A), false);
    await block.click(); await session.page.locator('#artistExclusionArtist').selectOption(C);
    await session.page.getByRole('button', { name: 'Nie lubię', exact: true }).click();
    assert.equal(await session.page.evaluate(C => artistExclusionStatus(C).entries[0].reason, C), 'dislike');
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test('stary import JSON nie usuwa odwołań nowych blokad; ponowny import jest idempotentny', async () => {
  const session = await harness.page();
  try {
    const state = await session.page.evaluate(({ A }) => {
      localStorage.setItem('office_seed_bartek', 'Queen');
      const old = exportedStorageState();
      localStorage.setItem('office_artist_identity_v2', 'opaque archived F data');
      const track = { id: 'a', name: 'Song', artists: [{ id: A, name: 'Days of the New' }] };
      setArtistExclusion(track, A, 'dislike'); setArtistExclusion(track, A, null);
      return { old, journal: localStorage.getItem(OfficeArtistExclusions.KEY) };
    }, { A });
    session.page.on('dialog', d => d.accept());
    for (let i = 0; i < 2; i++) {
      const loaded = session.page.waitForEvent('load');
      await session.page.locator('#importStateFile').setInputFiles({ name: `old-${i}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'office-music-state', version: 1, storage: state.old })) });
      await loaded;
      assert.equal(await session.page.evaluate(() => localStorage.getItem(OfficeArtistExclusions.KEY)), state.journal);
      assert.equal(await session.page.evaluate(() => localStorage.getItem('office_artist_identity_v2')), 'opaque archived F data');
    }
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test('autosync: po 409 scala wyjątki i nie oznacza zmiany z czasu PUT jako wysłanej', async () => {
  const result = await evaluate(async ({ A, B }) => {
    const track = id => ({ id: `t-${id}`, name: 'Song', artists: [{ id, name: 'Artist' }] });
    setArtistExclusion(track(A), A, 'wrong_artist');
    const original = cloudApiRequest, api = OfficeArtistExclusions;
    const value = { artistId: B, name: 'Artist', reason: 'dislike', trackId: 'b', trackName: 'Song', artists: [{ id: B, name: 'Artist' }], source: 'playlist_block', updatedAt: new Date().toISOString() };
    let remote = null, puts = 0, gets = 0;
    cloudApiRequest = async (_token, options) => {
      if (options.method === 'GET') { gets++; return { state: { [api.KEY]: remote } }; }
      if (++puts === 1) { remote = JSON.stringify(api.decide(null, B, value)); const err = new Error('Race'); err.status = 409; throw err; }
      remote = JSON.parse(options.body).state[api.KEY];
      if (puts === 2) setArtistExclusion(track(A), A, null);
      return { saved: 1 };
    };
    try {
      await autoSyncCloudState('test');
      const pending = lastCloudFingerprint !== cloudStateFingerprint();
      await uploadCloudStateIfChanged('test');
      return { pending, puts, gets, remoteA: api.status(api.parse(remote), A).blocked, remoteB: api.status(api.parse(remote), B).blocked };
    } finally { cloudApiRequest = original; }
  }, { A, B });
  assert.equal(result.pending, true); assert.equal(result.puts, 3); assert.equal(result.remoteA, false); assert.equal(result.remoteB, true);
});

test('wyczyszczenie blokad zachowuje tombstones; stare oceny i archiwum F pozostają nietknięte', async () => {
  const result = await evaluate(({ A }) => {
    const track = { id: 'song', name: 'Song', artists: [{ id: A, name: 'Days of the New' }] };
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ old: { value: 1, artists: ['days of the new'] } }));
    localStorage.setItem(FEEDBACK_BLOCKED_ARTISTS_KEY, JSON.stringify({ 'legacy artist': { name: 'Legacy Artist' } }));
    localStorage.setItem('office_artist_identity_v2', 'opaque F archive');
    setArtistExclusion(track, A, 'wrong_artist'); const old = localStorage.getItem(OfficeArtistExclusions.KEY);
    const confirmBefore = window.confirm; window.confirm = () => true;
    try { clearFeedbackArtistBlocks(); } finally { window.confirm = confirmBefore; }
    applyCloudStateWithMerge({ [OfficeArtistExclusions.KEY]: old });
    return { blocked: trackHasArtistExclusion(track), legacy: loadFeedbackBlockedArtists(), grade: loadFeedback().old.value, archive: localStorage.getItem('office_artist_identity_v2') };
  }, { A });
  assert.deepEqual(result, { blocked: false, legacy: {}, grade: 1, archive: 'opaque F archive' });
});

test('wyjątki nie zmieniają dowodów Last.fm, wzorców, historii, punktacji ani limitów', async () => {
  const result = await evaluate(({ A, B }) => {
    const tracks = [A, B].map(id => ({ id: `t${id}`, uri: `spotify:track:t${id}`, name: 'Song', artists: [{ id, name: 'Days of the New' }] }));
    const now = Date.now(), selected = [{ id: 'bartek', artists: ['Days of the New'], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] } }];
    localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify([{ artist: 'Days of the New', track: 'Song', tags: ['rock'], sources: ['tag'], savedAt: now }]));
    localStorage.setItem(HISTORY_KEY, JSON.stringify([{ trackId: 'old', trackName: 'Old', artistIds: [B], artistNames: ['Days of the New'], source: 'spotify', playedAt: new Date().toISOString() }]));
    const summary = () => {
      const ctx = buildGroupRecommendationContext(selected);
      return tracks.map(track => ({ feedback: feedbackScore(track), recognizability: recognizabilityScore(track), seed: preferredArtistBonus(track, selected[0].artists), static: groupCandidateStatic(track, ctx).groupBase, signature: trackSignature(track), artists: [...trackArtistKeys(track)] }));
    };
    const before = summary(), history = localStorage.getItem(HISTORY_KEY);
    setArtistExclusion(tracks[0], A, 'wrong_artist');
    return { before, after: summary(), historyUnchanged: localStorage.getItem(HISTORY_KEY) === history, sameLimit: [...trackArtistKeys(tracks[0])][0] === [...trackArtistKeys(tracks[1])][0] };
  }, { A, B });
  assert.deepEqual(result.after, result.before); assert.equal(result.historyUnchanged, true); assert.equal(result.sameLimit, true);
});

test('brak alternatywnego katalogu i brak API nie cofają blokady ani nie uruchamiają pobierania', async () => {
  const result = await evaluate(({ A }) => {
    const original = window.fetch; let calls = 0;
    window.fetch = async () => { calls++; throw new TypeError('Offline'); };
    try {
      const track = { id: 'a', name: 'Song', artists: [{ id: A, name: 'Days of the New' }] };
      openArtistExclusionDialog(track); submitArtistExclusion('wrong_artist');
      return { blocked: trackHasArtistExclusion(track), candidates: cachedArtistCatalogAlternatives('Days of the New', A), text: document.getElementById('artistExclusionCandidates').textContent, calls };
    } finally { window.fetch = original; }
  }, { A });
  assert.equal(result.blocked, true); assert.deepEqual(result.candidates, []); assert.match(result.text, /Brak innego katalogu/); assert.equal(result.calls, 0);
});

test('nieudany autosync/429 zachowuje lokalną decyzję, a cold start bez wyjątków nie dodaje GET', async () => {
  const result = await evaluate(async ({ A }) => {
    const original = cloudApiRequest; let gets = 0, puts = 0;
    cloudApiRequest = async (_token, options) => {
      if (options.method === 'GET') { gets++; return { state: {} }; }
      puts++; return { saved: 1 };
    };
    try {
      await uploadCloudStateIfChanged('test', { force: true });
      const coldGets = gets;
      const track = { id: 'a', name: 'Song', artists: [{ id: A, name: 'Days of the New' }] };
      setArtistExclusion(track, A, 'dislike');
      cloudApiRequest = async () => { const e = new Error('Rate limited'); e.status = 503; throw e; };
      let error = ''; try { await uploadCloudStateIfChanged('test', { force: true }); } catch (e) { error = e.message; }
      return { coldGets, puts, error, blocked: trackHasArtistExclusion(track) };
    } finally { cloudApiRequest = original; }
  }, { A });
  assert.deepEqual(result, { coldGets: 0, puts: 1, error: 'Rate limited', blocked: true });
});

test('import z częściowym błędem quota przywraca bazę i dziennik wyjątków', async () => {
  const session = await harness.page();
  try {
    const before = await session.page.evaluate(({ A }) => {
      setArtistExclusion({ id: 'song', name: 'Song', artists: [{ id: A, name: 'Days of the New' }] }, A, 'dislike');
      localStorage.setItem('office_seed_bartek', 'Queen');
      const state = exportedStorageState(), original = Storage.prototype.setItem;
      let fail = true;
      Storage.prototype.setItem = function(key, value) { if (key === 'office_blocked_bartek' && fail) { fail = false; throw new DOMException('Full', 'QuotaExceededError'); } return original.call(this, key, value); };
      return state;
    }, { A });
    session.page.on('dialog', d => d.accept());
    const alert = session.page.waitForEvent('dialog', { predicate: d => d.type() === 'alert' });
    await session.page.locator('#importStateFile').setInputFiles({ name: 'quota.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'office-music-state', version: 1, storage: { office_seed_bartek: 'Wrong', office_blocked_bartek: 'Wrong' } })) });
    assert.match((await alert).message(), /Nie udało się/);
    assert.deepEqual(await session.page.evaluate(() => exportedStorageState()), before); assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});
