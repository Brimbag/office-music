import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startBrowserHarness } from './helpers/browser.mjs';
const baseline = JSON.parse(readFileSync(new URL('./fixtures/p3-baseline-v43.22.json', import.meta.url), 'utf8'));
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(fn, arg) {
  const session = await harness.page();
  try { const result = await session.page.evaluate(fn, arg); assert.deepEqual(session.errors, []); return result; }
  finally { await session.close(); }
}
for (const people of [2, 4]) test(`${people} osoby: reuse pokrycia i identyczna kwalifikacja oraz selekcja względem P.2`, async () => {
  const r = await evaluate(({ people }) => {
    const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, artists: ['A'], blockedArtists: [], taste: { hasSurvey: true, likedGenres: ['Rock'] } }));
    const tracks = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ id: `a${i}`, name: i < 2 ? 'A' : `Artist ${i}` }] }));
    const now = Date.now();
    localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now }))));
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(tracks.map(track => ({ artist: track.artists[0].name, tags: ['rock'], sources: ['tag'], savedAt: now }))));
    const a = createCandidateAcquisition(selected); a.blockProfiles = selected;
    const one = getAcquisitionCoverage(a), two = getAcquisitionCoverage(a), fresh = acquisitionCoverage(selected, generationBlocklists(selected));
    const normalize = value => ({ ids: value.qualifying.map(item => item.track.id), scores: value.qualifying.map(item => item.byUser), artists: [...value.byArtist].map(([k,v]) => [k,[...v]]), capacity: [...value.queryCapacity] });
    const choose = value => { Math.random = () => .25; const ctx = acquisitionContext(selected); return selectGroupPlaylist(value.qualifying, 6, ctx, newRejectionStats(10)).tracks.map(t => t.id); };
    return { hit: one === two, cached: normalize(two), fresh: normalize(fresh), cachedSelection: choose(two), freshSelection: choose(fresh) };
  }, { people });
  assert.equal(r.hit, true); assert.deepEqual(r.cached, r.fresh); assert.deepEqual(r.cachedSelection, r.freshSelection);
});
test('cache pokrycia unieważnia wszystkie zależności: pule, feedback, blokady, historia, konto, preferencje i ustawienia', async () => {
  const r = await evaluate(() => {
    const selected = [{ id: 'bartek', artists: [], blockedArtists: [], taste: {} }];
    const a = createCandidateAcquisition(selected); a.blockProfiles = selected;
    const checks = [];
    for (const [key, value] of [[CANDIDATE_POOL_KEY, '[] '], [LASTFM_ARTIST_POOL_KEY, '[] '], [LASTFM_TRACK_POOL_KEY, '[] '],
      [FEEDBACK_KEY, '{} '], [FEEDBACK_BLOCKED_ARTISTS_KEY, '{} '], [HISTORY_KEY, '[] '], [OfficeArtistExclusions.KEY, '{} '],
      [LASTFM_USER_KEY, 'changed'], [TASTE_STORAGE_KEY, '{} ']]) {
      const before = getAcquisitionCoverage(a); localStorage.setItem(key, value); checks.push(getAcquisitionCoverage(a) !== before);
    }
    let before = getAcquisitionCoverage(a); selected[0].taste.likedGenres = ['Rock']; checks.push(getAcquisitionCoverage(a) !== before);
    before = getAcquisitionCoverage(a); avoidRemixes.checked = !avoidRemixes.checked; checks.push(getAcquisitionCoverage(a) !== before);
    before = getAcquisitionCoverage(a); recognizabilityLevel.value = 'low'; checks.push(getAcquisitionCoverage(a) !== before);
    return checks;
  });
  assert.ok(r.length >= 12 && r.every(Boolean));
});
test('granice TTL/recent/history oraz cofnięcie zegara nie używają starego pokrycia', async () => {
  const r = await evaluate(() => {
    let now = Date.now(); const original = Date.now; Date.now = () => now;
    try {
      const track = { id: 'one', uri: 'spotify:track:one', name: 'One', artists: [{ id: 'a', name: 'A' }] };
      localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify([{ track, queries: ['genre:"rock"'], savedAt: now - CANDIDATE_POOL_MAX_AGE_MS + 5 }]));
      localStorage.setItem(LASTFM_USER_KEY, 'owner');
      localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify([{ artist: 'A', tags: ['rock'], sources: ['recent'], savedAt: now, recentObservation: { user: 'owner', plays: [(now + 10) / 1000 - LASTFM_HISTORY_WINDOW_DAYS * 86400] } }]));
      const selected = [{ id: 'bartek', artists: [], blockedArtists: [], taste: { hasSurvey: true, likedGenres: ['Rock'] } }];
      const a = createCandidateAcquisition(selected); a.blockProfiles = selected;
      const before = getAcquisitionCoverage(a); now += 6; const expired = getAcquisitionCoverage(a);
      now += 5; const recentExpired = getAcquisitionCoverage(a); now -= 20; const reversed = getAcquisitionCoverage(a);
      const b = createCandidateAcquisition(selected), other = getAcquisitionCoverage(b);
      return { ttl: before !== expired, recent: expired !== recentExpired, backwards: recentExpired !== reversed, separate: other !== reversed, expiredLength: expired.qualifying.length };
    } finally { Date.now = original; }
  });
  assert.deepEqual(r, { ttl: true, recent: true, backwards: true, separate: true, expiredLength: 0 });
});
test('cache-first i pomijanie pokrytych artystów zachowują wyszukiwania oraz rotację P.2; pusty i wygasły cache', async () => {
  const r = await evaluate(async ({ source }) => {
    const now = Date.now(), selected = [{ id: 'bartek', artists: ['A', 'B'], blockedArtists: [], genres: [], categories: [], taste: { hasSurvey: true, likedGenres: ['Rock'] } }];
    const make = (artist, i) => ({ id: `${artist}${i}`, uri: `spotify:track:${artist}${i}`, name: `Song ${i}`, artists: [{ name: artist }] });
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(['A','B'].map(artist => ({ artist, tags: ['rock'], sources: ['tag'], savedAt: now }))));
    const pool = [0,1].map(i => ({ track: make('A',i), queries: ['artist:"A"'], savedAt: now }));
    const original = primeDiverseQueries;
    const outputs = [];
    for (const policy of ['before','after']) {
      localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(pool));
      localStorage.setItem(searchCacheKey('artist:"B"',0), JSON.stringify({ savedAt: now - SEARCH_CACHE_TTL_MS - 1, items: [make('B',0)] }));
      writeSearchCache('artist:"B"',10, []);
      newSearchesThisGeneration = 0; maxNewSearchesThisGeneration = 12;
      const calls = []; searchTracks = async (_t,q) => { calls.push(q); newSearchesThisGeneration++; return []; };
      primeDiverseQueries = policy === 'before' ? (0,eval)(`(${source})`) : original;
      await primeManualSeedArtists('mock',selected,3);
      outputs.push({ calls, pool: loadCandidatePool().map(row => row.track.id) });
    }
    return outputs;
  }, { source: baseline.functions.primeDiverseQueries });
  assert.deepEqual(r[0],r[1]); assert.deepEqual(r[1].calls,['artist:"B"']);
});
for (const outcome of ['cloud-error','write-error','search-error']) test(`pełny panel: ${outcome}, stan tła, guard podwójnego startu i zachowanie wyniku`, async () => {
  const r = await evaluate(async outcome => {
    const selected = ['bartek','asia'].map(id => ({ id, name: profiles[id].name, artists: [], genres: ['rock'], categories: [], blockedArtists: [], taste: { hasSurvey: true, likedGenres: ['Rock'] } }));
    const tracks = [0,1,2].map(i => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ id: `a${i}`, name: `A${i}` }] }));
    const now = Date.now();
    localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now }))));
    localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(tracks.map(track => ({ artist: track.artists[0].name, track: track.name, tags: ['rock'], savedAt: now }))));
    localStorage.setItem('spotify_access_token','old'); localStorage.setItem('spotify_refresh_token','r');localStorage.setItem('spotify_token_expires',String(now+3600000));
    saveRecentPlaylistSnapshot({id:'previous',name:'Previous'},tracks,selected,3,null);
    selectedProfiles = () => selected; cleanupOldOfficePlaylists = async () => ({}); refreshLastFmBeforeGeneration = async () => {}; syncSpotifyRecentHistory = async () => {};
    waitForSearchSlot = async () => {}; primeProfileGenres = async () => {}; primeCommonGroupQueries = async () => {};
    let release, signalEntered; const enteredPromise = new Promise(resolve => { signalEntered = resolve; });
    let entered = false, startCount = 0, refreshes = 0, searches = 0, creates = 0, adds = 0;
    primeManualSeedArtists = async () => { startCount++; entered = true; signalEntered(); await new Promise(resolve => { release=resolve; }); if (outcome==='search-error') throw new Error('Próba wyszukiwania przerwana'); await searchTracks('old','genre:"rock"'); };
    window.fetch = async (url, options) => {
      if(String(url).includes('/api/token')) { refreshes++; return Response.json({access_token:'new',refresh_token:'rotated',expires_in:3600}); }
      if(String(url).includes('/search')) { searches++; return options.headers.Authorization==='Bearer old' ? Response.json({}, {status:401}) : Response.json({tracks:{items:[]}}); }
      if(String(url).includes('/items')) { adds++; if(outcome==='write-error') throw new TypeError('Zapis mógł zostać wykonany'); return Response.json({snapshot_id:'done'}); }
      creates++; return Response.json({id:'made',name:'Made',uri:'spotify:playlist:made'});
    };
    uploadCloudStateIfChanged = async () => { throw new Error('D1 unavailable'); };
    const running = generateOfficePlaylist();
    await enteredPromise;
    await generateOfficePlaylist();
    const disabledDuring = generateButton.disabled;
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); document.dispatchEvent(new Event('visibilitychange'));
    const hiddenText = progressBox.textContent; release(); await running;
    const report = lastGenerationReport, snapshot = loadRecentPlaylists()[0];
    return { startCount, disabledDuring, enabledAfter: !generateButton.disabled, hiddenText, report, snapshotLength: snapshot?.tracks?.length || 0, snapshotId: snapshot?.id,
      text: progressBox.textContent, playlist: playlistResult.textContent, creates, adds, searches, refreshes, sourceRestored: !generationInFlight && activeGenerationProgress===null };
  }, outcome);
  assert.equal(r.startCount,1); assert.equal(r.disabledDuring,true); assert.equal(r.enabledAfter,true); assert.equal(r.sourceRestored,true); assert.match(r.hiddenText,/Karta jest w tle/);
  assert.ok(r.report.totalMs>=0); assert.ok(!JSON.stringify(r.report).includes('rotated')); assert.ok(!JSON.stringify(r.report).includes('Bearer'));
  if(outcome==='cloud-error') { assert.equal(r.report.outcome,'success'); assert.equal(r.snapshotLength,3); assert.equal(r.report.counters.searches,1); assert.equal(r.report.counters.searchRequests,2); assert.equal(r.refreshes,1); assert.equal(r.report.counters.oauthSuccess,1); assert.ok(r.report.warnings.length); assert.match(r.playlist,/Song/); }
  else { assert.equal(r.snapshotId,'previous'); assert.equal(r.snapshotLength,3); assert.equal(r.report.outcome,'error'); assert.match(r.text,/Etap:/); assert.equal(r.report.playlistCreated,outcome==='write-error'); assert.equal(r.creates,outcome==='write-error'?1:0); }
});
test('żywy feedback współwykonawcy i nowa historia rzeczywiście zmieniają kwalifikację po reuse', async () => {
  const r=await evaluate(() => {
    const now=Date.now(),selected=[{id:'bartek',artists:[],blockedArtists:[],taste:{hasSurvey:true,likedGenres:['Rock']}}];
    const aTrack={id:'one',uri:'spotify:track:one',name:'One',artists:[{id:'a',name:'A'},{id:'b',name:'B'}]}, bTrack={id:'two',uri:'spotify:track:two',name:'Two',artists:[{id:'b',name:'B'}]};
    localStorage.setItem(CANDIDATE_POOL_KEY,JSON.stringify([aTrack,bTrack].map(track=>({track,queries:['genre:"rock"'],savedAt:now}))));
    localStorage.setItem(LASTFM_TRACK_POOL_KEY,JSON.stringify([{artist:'A',track:'One',tags:['rock'],savedAt:now},{artist:'B',track:'Two',tags:['rock'],savedAt:now}]));
    const a=createCandidateAcquisition(selected);a.blockProfiles=selected;
    const before=getAcquisitionCoverage(a).qualifying.map(item=>item.track.id);
    localStorage.setItem(FEEDBACK_KEY,JSON.stringify({other:{value:-1,artists:['a']}}));
    const afterFeedback=getAcquisitionCoverage(a).qualifying.map(item=>item.track.id);
    localStorage.setItem(HISTORY_KEY,JSON.stringify([{trackId:'two',trackName:'Two',artistNames:['B'],artistIds:['b'],playedAt:new Date(now).toISOString(),source:'spotify'}]));
    return {before,afterFeedback,afterHistory:getAcquisitionCoverage(a).qualifying.map(item=>item.track.id)};
  });
  assert.deepEqual(r,{before:['one','two'],afterFeedback:['two'],afterHistory:[]});
});
test('uszkodzone rekordy i plays nie psują terminu ważności pokrycia', async () => {
  const r=await evaluate(() => {
    localStorage.setItem(CANDIDATE_POOL_KEY,'[null,{},false]');
    localStorage.setItem(LASTFM_ARTIST_POOL_KEY,JSON.stringify([null,{artist:'Broken',savedAt:Date.now(),recentObservation:{plays:{invalid:true}}}]));
    localStorage.setItem(LASTFM_TRACK_POOL_KEY,'[null]');localStorage.setItem(HISTORY_KEY,'[null]');
    const a=createCandidateAcquisition([{id:'bartek',artists:[],blockedArtists:[],taste:{}}]);
    return getAcquisitionCoverage(a).qualifying.length;
  });
  assert.equal(r,0);
});
