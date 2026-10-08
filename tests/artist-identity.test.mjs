import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(run, arg) {
  const session = await harness.page();
  try { const result = await session.page.evaluate(run, arg); assert.deepEqual(session.errors, []); return result; }
  finally { await session.close(); }
}
const A = '1111111111111111111111', B = '2222222222222222222222';

test('Days of the New: dwa ID, osobne nagrania i oceny, kara nie przechodzi na homonima ani partnera', async () => {
  const result = await evaluate(({ A, B }) => {
    const make = (id, artist) => ({ id, uri: `spotify:track:${id}`, name: 'Touch, Peel and Stand', artists: [{ id: artist, name: 'Days of the New' }] });
    const a = make('track-a', A), b = make('track-b', B);
    setTrackFeedback(a, -1);
    const duet = { ...b, artists: [...b.artists, ...a.artists] };
    const stats = feedbackArtistStats();
    return {
      separateArtists: !tracksShareArtist(a, b), separateRecordings: trackSignature(a) !== trackSignature(b),
      a: trackFeedbackValue(a), b: trackFeedbackValue(b),
      penalties: [a, b, duet].map(t => hasStrongNegativeArtistFeedback(t, stats)),
      canonicalSameId: trackSignature(a) === trackSignature({ ...a, id: 'different-edition', name: 'Touch, Peel and Stand - 2025 Remaster' }),
      aliasSameId: tracksShareArtist(a, { ...a, artists: [{ id: A, name: 'Renamed' }] }),
      legacy: localStorage.getItem(FEEDBACK_KEY), data: Object.values(loadFeedback())[0]
    };
  }, { A, B });
  assert.equal(result.separateArtists, true); assert.equal(result.separateRecordings, true);
  assert.deepEqual([result.a, result.b], [-1, 0]); assert.deepEqual(result.penalties, [true, false, true]);
  assert.equal(result.canonicalSameId, true); assert.equal(result.aliasSameId, true); assert.equal(result.legacy, null);
  assert.equal(result.data.trackId, 'track-a'); assert.equal(result.data.artists[0].id, A);
});

test('wzorzec, blokada i most Last.fm wymagają osobnych potwierdzeń', async () => {
  const result = await evaluate(({ A, B }) => {
    const a = { name: 'Song', artists: [{ id: A, name: 'Days of the New' }] }, b = { ...a, artists: [{ id: B, name: 'Days of the New' }] };
    const profile = { id: 'bartek', artists: ['Days of the New'], blockedArtists: ['Days of the New'], taste: {} };
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([{ artist: 'Days of the New', tags: ['rock'], recentCount: 5, sources: ['tag'], savedAt: Date.now() }]));
    const before = [a, b].map(t => ({ bonus: preferredArtistBonus(t, profile.artists, profile), evidence: lastFmEvidenceForTrack(t) }));
    writeIdentityDecision(linkCell('seed:bartek', 'Days of the New'), { id: A, name: 'Days of the New' });
    const seedsOnly = [a, b].map(t => ({ bonus: preferredArtistBonus(t, profile.artists, profile), tags: lastFmEvidenceForTrack(t).maxTags }));
    writeIdentityDecision(linkCell('blocked:bartek', 'Days of the New'), { id: A, name: 'Days of the New' });
    writeIdentityDecision(linkCell('lastfm', 'Days of the New'), { id: A, name: 'Days of the New' });
    const ctx = buildGroupRecommendationContext([profile]);
    return { before, seedsOnly, blocks: [a, b].map(t => trackMatchesIdentityBlocks(t, selectedBlockedArtistNames([profile]))),
      features: [a, b].map(t => { const f = groupTrackFeatures(t, ctx); return { rock: f.aspects.has('rock'), recent: f.recentCount }; }) };
  }, { A, B });
  assert.ok(result.before.every(r => r.bonus === 0 && r.evidence.maxTags === 0 && r.evidence.recentCount === 0));
  assert.deepEqual(result.seedsOnly, [{ bonus: 106, tags: 0 }, { bonus: 0, tags: 0 }]);
  assert.deepEqual(result.blocks, [true, false]); assert.deepEqual(result.features, [{ rock: true, recent: 5 }, { rock: false, recent: 0 }]);
});

test('Spotify cooldown i duplikaty historii nie używają nazw ani pozycji osobnych tablic', async () => {
  const result = await evaluate(({ A, B }) => {
    const track = artist => ({ id: `new-${artist}`, name: 'Song', artists: [{ id: artist, name: 'Days of the New' }] });
    localStorage.setItem(HISTORY_KEY, JSON.stringify([{ trackId: 'old', trackName: 'Song', artistIds: [A], artistNames: ['Days of the New', 'Misaligned'], trackSignature: 'days of the new|song', source: 'spotify', playedAt: new Date().toISOString() }]));
    const lists = buildHistoryBlocklists();
    return { artists: [...lists.blockedArtists], names: [...lists.blockedArtistNamesFromHistory], blocked: [A, B].map(id => trackMatchesHistorySignatures(track(id), lists.blockedTrackSignatures)), signatures: [...lists.blockedTrackSignatures] };
  }, { A, B });
  assert.deepEqual(result.artists, [A]); assert.deepEqual(result.names, []); assert.deepEqual(result.blocked, [true, false]);
  assert.ok(result.signatures.every(s => s.startsWith(`spotify:artist:${A}|`)));
});

test('Last.fm bez ID: kwarantanna historii, następnie jawny most wyłącznie do A', async () => {
  const result = await evaluate(({ A, B }) => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([{ trackName: 'Song', artistIds: [], artistNames: ['Days of the New'], trackSignature: 'days of the new|song', source: 'lastfm', playedAt: new Date().toISOString() }]));
    const tracks = [A, B].map(id => ({ name: 'Song', artists: [{ id, name: 'Days of the New' }] }));
    const before = buildHistoryBlocklists();
    writeIdentityDecision(linkCell('lastfm', 'Days of the New'), { id: A, name: 'Days of the New' });
    const after = buildHistoryBlocklists();
    return { before: tracks.map(t => trackMatchesHistorySignatures(t, before.blockedTrackSignatures)), after: tracks.map(t => trackMatchesHistorySignatures(t, after.blockedTrackSignatures)), artists: [...after.blockedArtists] };
  }, { A, B });
  assert.deepEqual(result, { before: [true, true], after: [true, false], artists: [A] });
});

test('stara ocena pozostaje nietknięta: brak automatycznego przypisania, osobna kwarantanna i ręczne rozstrzygnięcie', async () => {
  const result = await evaluate(({ A, B }) => {
    const old = { 'days of the new|song': { value: -1, artists: ['days of the new'], track: 'Song' } };
    const raw = JSON.stringify(old); localStorage.setItem(FEEDBACK_KEY, raw);
    const tracks = [A, B].map(id => ({ id: `track-${id}`, name: 'Song', artists: [{ id, name: 'Days of the New' }] }));
    const before = tracks.map(t => ({ feedback: trackFeedbackValue(t), penalty: hasStrongNegativeArtistFeedback(t), pending: unresolvedIdentityPreference(t) }));
    writeIdentityDecision(linkCell('seed:bartek', 'Days of the New'), { id: A, name: 'Days of the New' });
    const afterSeed = tracks.map(unresolvedIdentityPreference);
    writeIdentityDecision('legacy-feedback:days of the new|song', { ...old['days of the new|song'], artists: tracks[0].artists, signature: trackSignature(tracks[0]), trackId: tracks[0].id });
    return { before, afterSeed, after: tracks.map(t => ({ feedback: trackFeedbackValue(t), pending: unresolvedIdentityPreference(t), penalty: hasStrongNegativeArtistFeedback(t) })), unchanged: localStorage.getItem(FEEDBACK_KEY) === raw };
  }, { A, B });
  assert.deepEqual(result.before, [{ feedback: 0, penalty: false, pending: true }, { feedback: 0, penalty: false, pending: true }]);
  assert.deepEqual(result.afterSeed, [true, true]); assert.equal(result.unchanged, true);
  assert.deepEqual(result.after, [{ feedback: -1, pending: false, penalty: true }, { feedback: 0, pending: false, penalty: false }]);
});

test('nowa blokada tylko ID A, usunięcie ma tombstone i stare snapshoty jej nie odtwarzają', async () => {
  const result = await evaluate(({ A, B }) => {
    const tracks = [A, B].map(id => ({ artists: [{ id, name: 'Days of the New' }] }));
    togglePrimaryArtistBlock(tracks[0]);
    const old = localStorage.getItem(OfficeArtistIdentity.KEY);
    const before = tracks.map(t => trackMatchesIdentityBlocks(t, feedbackBlockedArtistNames()));
    togglePrimaryArtistBlock(tracks[0]);
    applyCloudStateWithMerge({ [OfficeArtistIdentity.KEY]: old });
    return { before, after: tracks.map(t => trackMatchesIdentityBlocks(t, feedbackBlockedArtistNames())), legacy: localStorage.getItem(FEEDBACK_BLOCKED_ARTISTS_KEY) };
  }, { A, B });
  assert.deepEqual(result, { before: [true, false], after: [false, false], legacy: null });
});

test('dwie przeglądarki: konkurencyjne przypisania nie wybierają zwycięzcy; jawna decyzja zamyka konflikt', async () => {
  const result = await evaluate(({ A, B }) => {
    const api = OfficeArtistIdentity;
    const key = linkCell('lastfm', 'Days of the New');
    const a = api.decide(null, key, { id: A }, 'decision-a');
    const b = api.decide(null, key, { id: B }, 'decision-b');
    const merged = api.merge(a, b), reverse = api.merge(b, a);
    writeIdentityState(merged);
    const unresolved = confirmedLastFmKey('Days of the New');
    const resolution = api.decide(merged, key, { id: A }, 'resolution');
    const replay = api.merge(resolution, b);
    return { unresolved, conflict: api.read(merged, key).conflict, commutative: JSON.stringify(merged) === JSON.stringify(reverse), final: api.read(replay, key), idempotent: JSON.stringify(api.merge(replay, replay)) === JSON.stringify(replay) };
  }, { A, B });
  assert.equal(result.unresolved, ''); assert.equal(result.conflict, true); assert.equal(result.commutative, true);
  assert.equal(result.final.conflict, false); assert.equal(result.final.value.id, A); assert.equal(result.idempotent, true);
});

test('quota i uszkodzony rejestr nie powodują częściowej migracji ani powrotu do zgadywania', async () => {
  const result = await evaluate(({ A }) => {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ old: { value: -1, artists: ['days of the new'] } }));
    const before = exportedStorageState(), original = Storage.prototype.setItem;
    let error = '';
    Storage.prototype.setItem = function(key, value) { if (key === OfficeArtistIdentity.KEY) throw new DOMException('Full', 'QuotaExceededError'); return original.call(this, key, value); };
    try { writeIdentityDecision(linkCell('seed:bartek', 'Days of the New'), { id: A }); } catch (err) { error = err.name; }
    finally { Storage.prototype.setItem = original; }
    const unchanged = JSON.stringify(before) === JSON.stringify(exportedStorageState());
    localStorage.setItem(OfficeArtistIdentity.KEY, '{broken');
    let corrupt = false; try { feedbackScore({ artists: [{ id: A, name: 'Days of the New' }] }); } catch { corrupt = true; }
    return { error, unchanged, corrupt };
  }, { A });
  assert.deepEqual(result, { error: 'QuotaExceededError', unchanged: true, corrupt: true });
});

for (const people of [2, 4]) test(`stała pula ${people} profili: identyczne nazwy mają osobny limit 2 i nie przejmują ocen`, async () => {
  const result = await evaluate(({ people, A, B }) => {
    Math.random = () => 0.25;
    const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, artists: [], manualGenres: [], taste: { hasSurvey: true, likedGenres: ['Rock'] } }));
    const tracks = Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i % 2}`, artists: [{ id: i < 2 ? A : i < 4 ? B : `other-${Math.floor(i / 2)}`, name: i < 4 ? 'Days of the New' : `Other ${Math.floor(i / 2)}` }] }));
    const now = Date.now();
    // Each homonym has a separately confirmed Last.fm catalog namespace.
    const lastFm = tracks.map(track => ({ artist: `Catalog ${track.artists[0].id}`, track: track.name, tags: ['rock'], sources: ['tag'], savedAt: now }));
    localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(lastFm));
    for (const track of tracks) {
      writeIdentityDecision(linkCell('lastfm', `Catalog ${track.artists[0].id}`), track.artists[0]);
      setTrackFeedback(track, 1);
    }
    saveCandidatePool(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now })));
    const empty = () => new Set(), lists = { blockedTracks: empty(), blockedTrackSignatures: empty(), blockedArtists: empty(), historyBlockedNames: empty(), explicitBlockedNames: empty(), feedbackBlockedNames: empty() };
    function generate(pool) {
      saveCandidatePool(pool.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now })));
      const ctx = buildGroupRecommendationContext(selected), { eligible, stats } = eligibleGroupCandidates(selected, lists, ctx);
      const selection = selectGroupPlaylist(eligible, 12, ctx, stats);
      const counts = {};
      for (const track of selection.tracks) for (const key of trackArtistKeys(track)) counts[key] = (counts[key] || 0) + 1;
      return { length: selection.tracks.length, counts, averages: Object.values(selection.satisfaction).map(s => s.average) };
    }
    discoveryLevel.value = '100';
    const separated = generate(tracks.slice(0, 12));
    // Single negative for A excludes both its tracks, without reducing B's score.
    setTrackFeedback(tracks[0], -1); setTrackFeedback(tracks[1], 1); // toggle the second positive off => A balance -1
    const shortage = generate(tracks.slice(0, 12)), replacements = generate(tracks);
    return { separated, shortage, replacements };
  }, { people, A, B });
  assert.equal(result.separated.length, 12);
  assert.equal(result.separated.counts[`spotify:artist:${A}`], 2); assert.equal(result.separated.counts[`spotify:artist:${B}`], 2);
  assert.equal(result.shortage.length, 10); assert.equal(result.replacements.length, 12);
  for (const row of Object.values(result)) assert.ok(Object.values(row.counts).every(n => n <= 2));
  assert.ok(result.replacements.averages.every(n => n >= 35));
});

test('brak ID nie zapisuje nowej oceny ani blokady, importer nie zgaduje tożsamości', async () => {
  const result = await evaluate(() => {
    const track = { name: 'Song', artists: [{ name: 'Days of the New' }] };
    const errors = [];
    for (const action of [() => setTrackFeedback(track, -1), () => togglePrimaryArtistBlock(track)]) try { action(); } catch (e) { errors.push(e.message); }
    return { errors, state: localStorage.getItem(OfficeArtistIdentity.KEY) };
  });
  assert.equal(result.errors.length, 2); assert.ok(result.errors.every(e => e.includes('Spotify Artist ID'))); assert.equal(result.state, null);
});

test('nowy feedback <= -40: ID A odpada z cache, nowych stron, normalnej selekcji i fallbacku; B i partner pozostają', async () => {
  const result = await evaluate(async ({ A, B }) => {
    const make = (id, ids) => ({ id, uri: `spotify:track:${id}`, name: id, artists: ids.map(id => ({ id, name: id === A || id === B ? 'Days of the New' : 'Partner' })) });
    setTrackFeedback(make('prior', [A]), -1);
    const a = make('a', [A]), b = make('b', [B]), duet = make('duet', ['partner', A]), solo = make('solo', ['partner']);
    saveCandidatePool([a, b].map(track => ({ track, queries: ['genre:"rock"'], savedAt: Date.now() })));
    const original = searchTracks; searchTracks = async () => [duet, solo];
    const empty = () => new Set();
    let collected;
    try { collected = await collectFromQueries('test', ['genre:"rock"'], 2, empty(), empty(), new Map(), empty(), empty(), empty(), empty(), { recognizabilityOverride: 'low' }); }
    finally { searchTracks = original; }
    const paths = [60, 36].map(base => {
      const ctx = buildGroupRecommendationContext([{ id: 'bartek', artists: [], taste: {} }]);
      const items = [a, b, duet, solo].map(track => { const item = groupCandidateStatic(track, ctx); item.groupBase = base; item.minScore = 60; item.byUser.bartek.score = 60; item.features.discovery = false; return item; });
      return selectGroupPlaylist(items, 4, ctx, newRejectionStats(4)).tracks.map(t => t.id).sort();
    });
    return { collected: collected.map(t => t.id).sort(), paths };
  }, { A, B });
  assert.deepEqual(result.collected, ['b', 'solo']); assert.deepEqual(result.paths, [['b', 'solo'], ['b', 'solo']]);
});

test('przeglądarkowy panel wybiera Spotify ID, ale nie przypisuje przy tym dawnej oceny lub Last.fm', async () => {
  const session = await harness.page('/', { office_seed_bartek: 'Days of the New', office_music_feedback_v1: JSON.stringify({ 'days of the new|song': { value: -1, artists: ['days of the new'], track: 'Song' } }) });
  try {
    await session.page.evaluate(({ A, B }) => {
      document.getElementById('mixerBox').style.display = 'block';
      saveCandidatePool([A, B].map(id => ({ track: { id: `t${id}`, uri: `spotify:track:t${id}`, name: 'Song', artists: [{ id, name: 'Days of the New' }] }, queries: [], savedAt: Date.now() })));
    }, { A, B });
    await session.page.locator('#artistIdentityPanel summary').click();
    await session.page.locator('#artistIdentityFilter').fill('Days of the New');
    const row = session.page.locator('#artistIdentityRows > div').filter({ hasText: 'Bartek: wzorzec' });
    await row.locator('select').selectOption(A);
    assert.match(await row.locator('a').getAttribute('href'), new RegExp(A));
    session.page.on('dialog', d => d.accept());
    await row.getByRole('button', { name: 'Potwierdź to powiązanie' }).click();
    const result = await session.page.evaluate(() => ({ seed: confirmedProfileArtistKey({ id: 'bartek' }, 'seed', 'Days of the New'), lastfm: confirmedLastFmKey('Days of the New'), old: identityDecision('legacy-feedback:days of the new|song').exists }));
    assert.deepEqual(result, { seed: `spotify:artist:${A}`, lastfm: '', old: false });
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test('stary JSON importowany ponownie zachowuje decyzje v2 i oryginalne preferencje', async () => {
  const session = await harness.page();
  try {
    const before = await session.page.evaluate(({ A }) => {
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ old: { value: -1, artists: ['days of the new'] } }));
      const old = exportedStorageState();
      writeIdentityDecision(linkCell('seed:bartek', 'Days of the New'), { id: A, name: 'Days of the New' });
      return { old, journal: localStorage.getItem(OfficeArtistIdentity.KEY) };
    }, { A });
    session.page.on('dialog', d => d.accept());
    for (let i = 0; i < 2; i++) {
      const reloaded = session.page.waitForEvent('load');
      await session.page.locator('#importStateFile').setInputFiles({ name: `old-${i}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'office-music-state', version: 1, storage: before.old })) });
      await reloaded;
      assert.equal(await session.page.evaluate(() => localStorage.getItem(OfficeArtistIdentity.KEY)), before.journal);
      assert.equal(await session.page.evaluate(() => localStorage.getItem(FEEDBACK_KEY)), before.old.office_music_feedback_v1);
    }
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test('import z błędem quota po częściowym zapisie przywraca całą poprzednią bazę', async () => {
  const session = await harness.page();
  try {
    const before = await session.page.evaluate(() => {
      localStorage.setItem('office_seed_bartek', 'Queen');
      localStorage.setItem('office_history_fixture', 'keep');
      const initial = exportedStorageState();
      const original = Storage.prototype.setItem;
      let fail = true;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'office_blocked_bartek' && fail) { fail = false; throw new DOMException('Full', 'QuotaExceededError'); }
        return original.call(this, key, value);
      };
      return initial;
    });
    session.page.on('dialog', d => d.accept());
    const failed = session.page.waitForEvent('dialog', { predicate: dialog => dialog.type() === 'alert' });
    await session.page.locator('#importStateFile').setInputFiles({ name: 'quota.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'office-music-state', version: 1, storage: { office_seed_bartek: 'Wrong', office_blocked_bartek: 'Wrong' } })) });
    assert.match((await failed).message(), /Nie udało się/);
    assert.deepEqual(await session.page.evaluate(() => exportedStorageState()), before);
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test('autosync scala po 409 i wysyła oba konkurencyjne przypisania, bez utraty konfliktu', async () => {
  const result = await evaluate(async ({ A, B }) => {
    const api = OfficeArtistIdentity, key = linkCell('seed:bartek', 'Days of the New');
    writeIdentityDecision(key, { id: A });
    const remote = JSON.stringify(api.decide(null, key, { id: B }, 'remote'));
    const original = cloudApiRequest;
    let puts = 0, payload;
    cloudApiRequest = async (_token, options) => {
      if (options.method === 'GET') return { state: { [api.KEY]: puts ? remote : null } };
      if (++puts === 1) { const error = new Error('Race'); error.status = 409; throw error; }
      payload = JSON.parse(options.body);
      return { saved: Object.keys(payload.state).length };
    };
    try {
      await uploadCloudStateIfChanged('test', { force: true });
      return { puts, base: payload.identityBase, conflict: api.read(api.parse(payload.state[api.KEY]), key).conflict, local: identityDecision(key).conflict };
    } finally { cloudApiRequest = original; }
  }, { A, B });
  assert.equal(result.puts, 2); assert.ok(result.base); assert.equal(result.conflict, true); assert.equal(result.local, true);
});

test('Last.fm zachowuje MBID/URL bez tworzenia automatycznego mostu Spotify', async () => {
  const result = await evaluate(() => {
    addLastFmArtists([{ name: 'Days of the New', mbid: 'artist-mbid', url: 'https://www.last.fm/music/Days+of+the+New' }], { tags: ['rock'] });
    addLastFmTracks([{ name: 'Song', mbid: 'track-mbid', url: 'https://www.last.fm/music/Days+of+the+New/_/Song', artist: { name: 'Days of the New', mbid: 'artist-mbid', url: 'https://www.last.fm/music/Days+of+the+New' } }]);
    return { artist: loadLastFmArtistPool()[0], track: loadLastFmTrackPool()[0], link: confirmedLastFmKey('Days of the New') };
  });
  assert.equal(result.artist.mbid, 'artist-mbid'); assert.equal(result.track.artistMbid, 'artist-mbid'); assert.equal(result.track.mbid, 'track-mbid'); assert.ok(result.artist.url); assert.equal(result.link, '');
});

for (const penalty of [-39, -40, -41, -55]) test(`identyfikowany feedback: granica ${penalty} nie zależy od nazwy lub ścieżki selekcji`, async () => {
  const result = await evaluate(({ A, penalty }) => {
    const track = { id: 'song', uri: 'spotify:track:song', name: 'Song', artists: [{ id: A, name: 'Days of the New' }] };
    writeIdentityDecision('feedback:prior', { value: penalty / 55, artists: track.artists, track: 'Prior' });
    const paths = [60, 36].map(base => {
      const ctx = buildGroupRecommendationContext([{ id: 'bartek', artists: [], taste: {} }]), item = groupCandidateStatic(track, ctx);
      item.groupBase = base; item.minScore = 60; item.byUser.bartek.score = 60; item.features.discovery = false;
      return selectGroupPlaylist([item], 1, ctx, newRejectionStats(1)).tracks.length;
    });
    return { score: artistFeedbackScore(feedbackArtistStats().get(`spotify:artist:${A}`)), paths };
  }, { A, penalty });
  assert.equal(result.score, penalty); assert.deepEqual(result.paths, penalty <= -40 ? [0, 0] : [1, 1]);
});

test('Spotify ID: poprawne linki także intl-pl, odrzucenie zewnętrznych URL i pustych wartości', async () => {
  const result = await evaluate(({ A }) => {
    const valid = [A, `spotify:artist:${A}`, `https://open.spotify.com/artist/${A}?si=test`, `https://open.spotify.com/intl-pl/artist/${A}`].map(OfficeArtistIdentity.spotifyId);
    const invalid = ['', 'Days of the New', `https://evil.example/artist/${A}`, `javascript:${A}`, `https://open.spotify.com/track/${A}`].map(value => { try { OfficeArtistIdentity.spotifyId(value); return false; } catch { return true; } });
    return { valid, invalid };
  }, { A });
  assert.deepEqual(result.valid, [A, A, A, A]); assert.ok(result.invalid.every(Boolean));
});

test('zmiana lokalna podczas PUT pozostaje do kolejnego autosync, nie jest oznaczona jako wysłana', async () => {
  const result = await evaluate(async ({ A, B }) => {
    writeIdentityDecision(linkCell('seed:bartek', 'Days of the New'), { id: A });
    const original = cloudApiRequest;
    let mutate = true, puts = 0, remote = null;
    cloudApiRequest = async (_token, options) => {
      if (options.method === 'GET') return { state: { [OfficeArtistIdentity.KEY]: remote } };
      puts++; remote = JSON.parse(options.body).state[OfficeArtistIdentity.KEY];
      if (mutate) { mutate = false; writeIdentityDecision(linkCell('seed:asia', 'Days of the New'), { id: B }); }
      return { saved: 1 };
    };
    try {
      await autoSyncCloudState('test');
      const pending = lastCloudFingerprint !== cloudStateFingerprint();
      await uploadCloudStateIfChanged('test');
      return { pending, puts, uploaded: OfficeArtistIdentity.read(OfficeArtistIdentity.parse(remote), linkCell('seed:asia', 'Days of the New')).value.id };
    } finally { cloudApiRequest = original; }
  }, { A, B });
  assert.deepEqual(result, { pending: true, puts: 2, uploaded: B });
});

test('dawna blokada 🚫 jest kwarantanną nazwową, po rozstrzygnięciu blokuje tylko wskazany ID', async () => {
  const result = await evaluate(({ A, B }) => {
    const raw = JSON.stringify({ 'days of the new': { name: 'Days of the New', source: 'playlist_feedback' } });
    localStorage.setItem(FEEDBACK_BLOCKED_ARTISTS_KEY, raw);
    const tracks = [A, B].map(id => ({ artists: [{ id, name: 'Days of the New' }] }));
    const before = tracks.map(t => trackMatchesIdentityBlocks(t, feedbackBlockedArtistNames()));
    writeIdentityDecision(linkCell('legacy-block', 'Days of the New'), { id: A, name: 'Days of the New' });
    return { before, after: tracks.map(t => trackMatchesIdentityBlocks(t, feedbackBlockedArtistNames())), unchanged: localStorage.getItem(FEEDBACK_BLOCKED_ARTISTS_KEY) === raw };
  }, { A, B });
  assert.deepEqual(result, { before: [true, true], after: [true, false], unchanged: true });
});

test('filtr E1 korzysta z potwierdzonego ID, a nie tagów homonima', async () => {
  const result = await evaluate(({ A, B }) => {
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([{ artist: 'Def Leppard', tags: ['hard rock'], sources: ['tag'], savedAt: Date.now() }]));
    writeIdentityDecision(linkCell('lastfm', 'Def Leppard'), { id: A, name: 'Def Leppard' });
    return [A, B].map(id => hasAlternativeVersionMarker({ name: 'Animal', artists: [{ id, name: 'Def Leppard' }, { id: 'orchestra', name: 'Royal Philharmonic Orchestra' }] }));
  }, { A, B });
  assert.deepEqual(result, [true, false]);
});

test('rejestr odrzuca brak rodzica, cykl i powtórzony identyfikator zamiast pomijać dawne decyzje', async () => {
  const result = await evaluate(() => {
    const e = (id, parents) => ({ id, parents, value: null });
    return [[e('a', ['missing'])], [e('a', ['b']), e('b', ['a'])], [e('a', []), e('a', [])]].map(events => {
      try { OfficeArtistIdentity.parse({ version: 2, cells: { test: events } }); return false; } catch { return true; }
    });
  });
  assert.deepEqual(result, [true, true, true]);
});

test('limit całego payloadu chmury chroni lokalne dane i zatrzymuje PUT przed API', async () => {
  const result = await evaluate(async ({ A }) => {
    writeIdentityDecision(linkCell('seed:bartek', 'Days of the New'), { id: A });
    localStorage.setItem(RMF_SETTINGS_KEY, 'x'.repeat(2 * 1024 * 1024));
    const before = exportedStorageState(), original = cloudApiRequest;
    let puts = 0, error = '';
    cloudApiRequest = async (_token, options) => { if (options.method === 'GET') return { state: {} }; puts++; return {}; };
    try { await uploadCloudStateIfChanged('test', { force: true }); } catch (e) { error = e.message; }
    finally { cloudApiRequest = original; }
    return { puts, error, preserved: JSON.stringify(before) === JSON.stringify(exportedStorageState()) };
  }, { A });
  assert.equal(result.puts, 0); assert.match(result.error, /2 MiB/); assert.equal(result.preserved, true);
});
