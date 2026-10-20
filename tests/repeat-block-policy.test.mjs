import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';

// v1.0.13: replay cooldown is independent of rating resets and enablement.
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
        skip: stats.skipCooldown, auto: autoTrackFeedback.score(auditTrack.id), base: eligible[0]?.groupBase };
    };
  }, { at, trackId: TRACK });
}

async function seed(page) {
  await page.evaluate(() => {
    addLastFmTracks([{ name: auditTrack.name, artist: { name: 'ADÉLA' } }], { tags: ['rock'] });
    saveCandidatePool([{ track: auditTrack, queries: ['genre:"rock"'], savedAt: Date.now() }]);
  });
}

test('15 Oct early penalty / 16 Oct middle penalty: hard cooldown excludes despite an otherwise eligible score', async () => {
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
    assert.deepEqual(r.beforeSecond.ids, []); assert.deepEqual(r.afterSecond.ids, []);
    assert.equal(r.beforeSecond.skip, 1); assert.equal(r.afterSecond.skip, 1);
    assert.ok(r.beforeSecond.auto > -100 && r.beforeSecond.auto < -97);
    assert.ok(r.afterSecond.auto < -147 && r.afterSecond.auto > -150);
    assert.equal(r.events.first.weight, 100); assert.equal(r.events.second.weight, 50);
    assert.deepEqual(r.history, []); assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

for (const history of [false, true]) test(`reload + Search cache reuse: history=${history}, cooldown survives regardless`, async () => {
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
    // Freeze before startup cleanup runs: a CI host clock must not expire
    // this fixture's Search cache between navigation and setup().
    await s.page.addInitScript(at => {
      window.auditNow = at;
      Date.now = () => auditNow;
    }, SECOND);
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
    assert.deepEqual(r.pool, []);
    assert.deepEqual(r.generated.ids, []);
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
      const blocked = offset < 14 * DAY; // Both sources expire exactly after 14 days.
      assert.deepEqual(r.ids, blocked ? [] : [TRACK]);
      assert.equal(r.recent + r.skip, blocked ? 1 : 0); assert.ok(r.penalty < 0);
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

test('direct selector rechecks history for previously qualified candidates', async () => {
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
    assert.deepEqual(r.stale, []); assert.deepEqual(r.fresh.ids, []);
    assert.equal(r.fresh.recent, 1); assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('16 Oct generator excludes penalized Track ID and writes a safe alternative even with empty play history', async () => {
  const s = await harness.page();
  try {
    await setup(s.page); await seed(s.page);
    const r = await s.page.evaluate(async ({ first, second }) => {
      await autoTrackFeedback.configure(true);
      await autoTrackFeedback.record(auditEvent('generator', first));
      auditNow = second;
      const safe={...auditTrack,id:'safeAlternative',uri:'spotify:track:safeAlternative',name:'Safe choice',artists:[{id:'otherArtist',name:'Other Artist'}]};
      addLastFmTracks([{name:safe.name,artist:{name:'Other Artist'}}],{tags:['rock']});
      saveCandidatePool([...loadCandidatePool(),{track:safe,queries:['genre:"rock"'],savedAt:Date.now()}]);
      playlistLength.value = '30';
      selectedProfiles = () => auditProfiles;
      getValidAccessToken = async () => 'mock-token';
      cleanupOldOfficePlaylists = async () => ({ found: 0, removed: 0 });
      refreshLastFmBeforeGeneration = async () => {};
      // No new acquisition: real generator must qualify the persisted pool.
      primeManualSeedArtists = primeProfileGenres = primeCommonGroupQueries = async () => {};
      window.auditWrites = [];
      fetch = async (url, options={}) => {
        if(String(url)==='/api/play-cooldown')return options.method==='GET'
          ? Response.json({base:null,state:OfficePlayCooldown.empty('mock-owner')})
          : Response.json({state:JSON.parse(options.body).state});
        if(String(url)==='/api/track-cooldown')return options.method==='GET'
          ? Response.json({base:null,state:OfficeTrackCooldown.empty('mock-owner')})
          : Response.json({state:JSON.parse(options.body).state});
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
    assert.deepEqual(r.writes, [{ playlistId: 'mockNewPlaylist', uris: ['spotify:track:safeAlternative'] }]);
    assert.deepEqual(r.savedIds, ['safeAlternative']); assert.deepEqual(r.history, []);
    assert.equal(r.complete, true); assert.ok(r.penalty < -97 && r.penalty > -100);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('👍 and scoring off cannot bypass cooldown, including reload and the exact 14-day boundary', async () => {
  const s=await harness.page();
  try {
    await setup(s.page);await seed(s.page);
    await s.page.evaluate(async () => {
      await autoTrackFeedback.configure(true);await autoTrackFeedback.record(auditEvent('priority',Date.now()));
      await setTrackFeedback(auditTrack,1);await autoTrackFeedback.configure(false);
    });
    await s.page.addInitScript(at=>{window.auditNow=at;Date.now=()=>auditNow;},SECOND);
    await s.page.reload();await s.page.waitForFunction(()=>window.ommStorageReady!==false);await setup(s.page,SECOND);
    const r=await s.page.evaluate(first=>{
      const nextDay=auditGenerate();auditNow=first+OfficeTrackCooldown.WINDOW-1;const lastMillisecond=auditGenerate();
      auditNow++;return {nextDay,lastMillisecond,expired:auditGenerate(),enabled:autoTrackFeedback.enabled(),
        manual:trackFeedbackValue(auditTrack),penalty:autoTrackFeedback.score(auditTrack.id)};
    },FIRST);
    assert.equal(r.enabled,false);assert.equal(r.manual,1);assert.equal(r.penalty,0);
    assert.deepEqual(r.nextDay.ids,[]);assert.deepEqual(r.lastMillisecond.ids,[]);assert.deepEqual(r.expired.ids,[TRACK]);
    assert.deepEqual(s.errors,[]);
  } finally {await s.close();}
});

for(const base of [1000,40])test(`direct cached candidate with base ${base}: cooldown guards normal/fallback and repair`,async()=>{
  const s=await harness.page();
  try {
    await setup(s.page);await seed(s.page);
    const r=await s.page.evaluate(async base=>{
      const ctx=acquisitionContext(auditProfiles),{eligible,stats}=eligibleGroupCandidates(auditProfiles,generationBlocklists(auditProfiles),ctx);
      const item=eligible[0];item.groupBase=base;for(const p of auditProfiles)item.byUser[p.id].score=80;item.minScore=80;item.maxScore=80;
      await trackCooldown.record(auditEvent('stale',Date.now()));
      const result=selectGroupPlaylist(eligible,30,ctx,stats);return {ids:result.tracks.map(t=>t.id),excluded:stats.skipCooldown};
    },base);
    assert.deepEqual(r.ids,[]);assert.equal(r.excluded,1);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});

test('coverage cache expires at cooldown boundary and changes while scoring is disabled',async()=>{
  const s=await harness.page();
  try{
    await setup(s.page);await seed(s.page);
    const r=await s.page.evaluate(async()=>{
      const acquisition=createCandidateAcquisition(auditProfiles);acquisition.blockProfiles=auditProfiles;
      const before=getAcquisitionCoverage(acquisition).qualifying.length;
      await trackCooldown.record(auditEvent('cache',Date.now()));
      const during=getAcquisitionCoverage(acquisition).qualifying.length;
      const deadline=acquisition.coverageCache.until;
      auditNow+=OfficeTrackCooldown.WINDOW;
      return {before,during,after:getAcquisitionCoverage(acquisition).qualifying.length,deadline};
    });
    assert.equal(r.before,1);assert.equal(r.during,0);assert.equal(r.after,1);assert.equal(r.deadline,FIRST+14*DAY);
    assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});

test('cloud CAS retry unions blocks from two devices without enablement or manual-rating overrides',async()=>{
  const s=await harness.page();
  try{
    await setup(s.page);await seed(s.page);
    const r=await s.page.evaluate(async()=>{
      let gets=0,puts=0,remote={...OfficeTrackCooldown.empty('mock-owner'),tracks:{remoteTrack:Date.now()-1000}};
      await trackCooldown.record(auditEvent('local',Date.now()));
      fetch=async(_url,options)=>{
        if(options.method==='GET'){gets++;return Response.json({base:JSON.stringify(remote),state:remote});}
        puts++;if(puts===1){remote.tracks.concurrentTrack=Date.now();return Response.json({error:'conflict'},{status:409});}
        remote=OfficeTrackCooldown.merge(remote,JSON.parse(options.body).state,'mock-owner');return Response.json({state:remote});
      };
      await syncTrackCooldown('mock-token',{force:true});return {gets,puts,ids:[...trackCooldown.blocked()].sort()};
    });
    assert.equal(r.gets,2);assert.equal(r.puts,2);assert.deepEqual(r.ids,[TRACK,'concurrentTrack','remoteTrack'].sort());
    assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});

test('failed cloud confirmation stops generation before creating a Spotify playlist, honors Retry-After',async()=>{
  const s=await harness.page();
  try{
    await setup(s.page);await seed(s.page);
    const r=await s.page.evaluate(async()=>{
      let calls=0,creates=0;getValidAccessToken=async()=> 'mock-token';
      createPlaylist=async()=>{creates++;throw new Error('Unexpected playlist write');};
      fetch=async()=>{calls++;return Response.json({error:'private marker'},{status:429,headers:{'Retry-After':'60'}});};
      persistGenerationLog=async()=>({status:'local'});
      await generateOfficePlaylist();try{await syncTrackCooldown('mock-token',{force:true});}catch{}
      return {calls,creates,remaining:cooldownSyncBackoff.until-Date.now(),text:playlistResult.textContent};
    });
    assert.equal(r.calls,1);assert.equal(r.creates,0);assert.equal(r.remaining,60000);assert.doesNotMatch(r.text,/private marker/);
    assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});

for(const source of ['spotify','lastfm'])test(`14 days after ${source} play cannot be shortened by 👍, scoring off or a legacy duration`,async()=>{
  const s=await harness.page();
  try{
    await setup(s.page);await seed(s.page);
    const r=await s.page.evaluate(async({first,source})=>{
      saveHistory([{trackId:source==='spotify'?auditTrack.id:'',trackName:auditTrack.name,artistNames:['ADÉLA'],
        trackSignature:trackSignature(auditTrack),playedAt:new Date(first).toISOString(),source}]);
      await setTrackFeedback(auditTrack,1);await autoTrackFeedback.configure(false);
      const fixedUi=trackBlockDays.disabled && trackBlockDays.options.length===1 && trackBlockDays.value==='14';
      // A stale client/DOM value is not the authority for the lock duration.
      trackBlockDays.add(new Option('3 days','3'));trackBlockDays.value='3';
      auditNow=first+7*86400000;const seventhDay=auditGenerate();
      auditNow=first+OfficeTrackCooldown.WINDOW-1;const finalMillisecond=auditGenerate();auditNow++;
      return {fixedUi,seventhDay,finalMillisecond,expired:auditGenerate()};
    },{first:FIRST,source});
    assert.equal(r.fixedUi,true);assert.deepEqual(r.seventhDay.ids,[]);assert.deepEqual(r.finalMillisecond.ids,[]);
    assert.deepEqual(r.expired.ids,[TRACK]);assert.deepEqual(s.errors,[]);
  }finally{await s.close();}
});
