import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { startBrowserHarness } from './helpers/browser.mjs';
const source = readFileSync(new URL('../search-effectiveness.js', import.meta.url), 'utf8');
const baseline = JSON.parse(readFileSync(new URL('./fixtures/q1-3-search-diagnostics-baseline.json', import.meta.url), 'utf8'));
function tracker() { const ctx = vm.createContext({}); vm.runInContext(source, ctx); return ctx.OmmSearchEffectiveness.create(); }
const plain = value => JSON.parse(JSON.stringify(value));
test('pusta odpowiedź i odrzucenie wszystkich nazw są różnymi wynikami', () => {
  const a = tracker(), empty = a.begin('artist:"A"', 0, 'Gatunki', 'Spotify'), mismatch = a.begin('artist:"Mars Volta"', 10, 'Artyści wzorcowi', 'Spotify');
  a.response(empty, 0, [], 0); a.response(mismatch, 10, [], 50);
  const [one, two] = a.report().pages;
  assert.equal(one.raw, 0); assert.equal(one.nameRejected, 0);
  assert.equal(two.raw, 10); assert.equal(two.filtered, 0); assert.equal(two.nameRejected, 10);
  assert.equal(two.total, 50); assert.match(a.text(), /kwalifikacja nieukończona/);
});
test('unikalne ID, retencja, pierwszy powód odrzucenia i współwykonawcy', () => {
  const a = tracker(), p = a.begin('genre:"rock"', 20, 'Gatunki', 'Spotify');
  const tracks = ['old','new','bad','lost'].map(id => ({ id }));
  a.baselineArtists(['old-artist']); a.response(p, 5, [...tracks, tracks[1]], 100); a.pool(p, 3, 1, ['new','bad','lost']);
  a.observe(tracks[2], 'lowIndividualFit'); a.observe(tracks[2], 'recognizability');
  const eligible = tracks.slice(0, 2).map(track => ({ track }));
  a.finish(new Map(tracks.slice(0,3).map(t => [t.id,t])), eligible, [tracks[1]], () => true, t => new Set(t.id === 'old' ? ['old-artist'] : ['new-artist','coartist']));
  const row = a.report().pages[0];
  assert.equal(row.retained, 3); assert.equal(row.safe, 2); assert.equal(row.newSafe, 1); assert.equal(row.artists, 3); assert.equal(row.newArtists, 2); assert.equal(row.selected, 1);
  assert.deepEqual(plain(row.rejected), { lowIndividualFit: 1 });
  assert.ok(!('ids' in row)); assert.ok(!('newIds' in row));
});
test('niedostateczny wynik bezpiecznej selekcji nie jest fałszywą kwalifikacją', () => {
  const a = tracker(), p = a.begin('x', 0, 'Gatunki', 'Spotify'), track = { id: 't' };
  a.response(p, 1, [track], null); a.finish(new Map([['t',track]]), [{ track }], [], () => false, () => []);
  assert.equal(a.report().pages[0].safe, 0); assert.deepEqual(plain(a.report().pages[0].rejected), { belowSafe: 1 });
});
test('stary cache nie udaje surowego wyniku; raport jest odseparowaną kopią', () => {
  const a = tracker(), p = a.begin('x', 0, 'Gatunki', 'cache'); a.response(p, null, [], null);
  const first = a.report(); first.pages[0].query = 'modified';
  assert.equal(a.report().pages[0].query, 'x'); assert.equal(a.report().pages[0].raw, null); assert.match(a.text(), /metadanych w starszym cache/);
});
test('diagnoza jest ograniczona i resetowana między generowaniami', () => {
  const a = tracker(); for (let i=0; i<130; i++) a.begin('a'.repeat(500), i, 'Gatunki', 'cache');
  assert.equal(a.report().pages.length, 120); assert.equal(a.report().omitted, 10); assert.equal(a.report().pages[0].query.length, 240);
  assert.equal(tracker().report().pages.length, 0);
});
test('błędy zapisują tylko status, bez treści odpowiedzi i danych sesji', () => {
  const a = tracker(); for (const status of [null,401,403,429]) { const p = a.begin('x',0,'Gatunki','Spotify'); a.error(p,status); }
  assert.deepEqual(plain(a.report().pages.map(p=>p.status)), ['network-error','http-401','http-403','http-429']);
});
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(fn, arg) {
  const session = await harness.page();
  try { const result = await session.page.evaluate(fn, arg); assert.deepEqual(session.errors, []); return result; }
  finally { await session.close(); }
}
test('Search: odrzucenie The Mars Volta jest widoczne bez zmiany filtra nazw', async () => {
  const r = await evaluate(async () => {
    const progress = OmmGenerationProgress.create(progressBox, 60); activeGenerationProgress = progress; progress.stage(4);
    waitForSearchSlot = async () => {}; let calls = 0;
    fetch = async () => { calls++; return Response.json({ tracks: { total: 12, items: [{ id:'t',uri:'spotify:track:t',name:'Song',artists:[{id:'a',name:'The Mars Volta'}] }] } }); };
    const tracks = await searchTracks('not-a-real-token', 'artist:"Mars Volta"', 10);
    progress.finish(null,0); activeGenerationProgress = null;
    return { tracks, calls, page:progress.report().searchEffectiveness.pages[0], metadata:JSON.parse(localStorage.getItem(searchCacheKey('artist:"Mars Volta"',10))).metadata, text:progressBox.textContent };
  });
  assert.equal(r.calls,1); assert.equal(r.tracks.length,0); assert.equal(r.page.raw,1); assert.equal(r.page.nameRejected,1); assert.equal(r.page.stage,'Artyści wzorcowi'); assert.deepEqual(r.metadata,{raw:1,total:12}); assert.ok(!r.text.includes('not-a-real-token'));
});
for (const modern of [false,true]) test(`cache ${modern ? 'nowy' : 'legacy'}: bez API i bez fałszywego zera surowych wyników`, async () => {
  const r = await evaluate(async modern => {
    writeSearchCache('genre:"rock"',0,[],modern?{raw:4,total:50}:null);
    let calls=0; fetch=async()=>{calls++;throw new Error('Forbidden');};
    const p=OmmGenerationProgress.create(progressBox,60); activeGenerationProgress=p;p.stage(5);
    await searchTracks('token','genre:"rock"',0);p.finish(null,0);activeGenerationProgress=null;
    return {calls,page:p.report().searchEffectiveness.pages[0]};
  },modern);
  assert.equal(r.calls,0);assert.equal(r.page.source,'cache');assert.equal(r.page.raw,modern?4:null);assert.equal(r.page.nameRejected,modern?4:null);
});
test('401 i 429 tworzą jedną stronę diagnostyki, zachowując budżet oraz retry OAuth', async () => {
  const r = await evaluate(async () => {
    const now=Date.now();localStorage.setItem('spotify_access_token','old');localStorage.setItem('spotify_refresh_token','refresh-secret');localStorage.setItem('spotify_token_expires',String(now+3600000));
    waitForSearchSlot=async()=>{};sleep=async()=>{};let search=0,refresh=0;
    fetch=async url=>{if(String(url).includes('/api/token')){refresh++;return Response.json({access_token:'new-secret',refresh_token:'rotated-secret',expires_in:3600});}search++;return search===1?Response.json({}, {status:401}):search===2?Response.json({}, {status:429,headers:{'Retry-After':'1'}}):Response.json({tracks:{items:[],total:0}});};
    newSearchesThisGeneration=0;const p=OmmGenerationProgress.create(progressBox,60);activeGenerationProgress=p;p.stage(5);
    await searchTracks('old','genre:"rock"');p.finish(null,0);activeGenerationProgress=null;
    return {search,refresh,budget:newSearchesThisGeneration,report:p.report(),text:progressBox.textContent};
  });
  assert.equal(r.search,3);assert.equal(r.refresh,1);assert.equal(r.budget,1);assert.equal(r.report.searchEffectiveness.pages.length,1);assert.equal(r.report.searchEffectiveness.pages[0].status,'ok');assert.equal(r.report.counters.searchRequests,3);assert.ok(!JSON.stringify(r.report).includes('secret'));assert.ok(!r.text.includes('secret'));
});
test('błąd sieci nie zapisuje cache ani nie udaje pustego sukcesu', async () => {
  const r = await evaluate(async () => {
    waitForSearchSlot=async()=>{};fetch=async()=>{throw new TypeError('network');};
    const p=OmmGenerationProgress.create(progressBox,60);activeGenerationProgress=p;p.stage(5);
    try{await searchTracks('token','genre:"rock"');}catch(err){p.finish(err);}activeGenerationProgress=null;
    return {page:p.report().searchEffectiveness.pages[0],cache:readSearchCache('genre:"rock"',0)};
  });assert.equal(r.page.status,'network-error');assert.equal(r.page.raw,null);assert.equal(r.cache,null);
});
test('brak pola items w odpowiedzi nie udaje potwierdzonej pustej strony', async () => {
  const r=await evaluate(async()=>{
    waitForSearchSlot=async()=>{};fetch=async()=>Response.json({});
    const p=OmmGenerationProgress.create(progressBox,60);activeGenerationProgress=p;p.stage(5);
    const items=await searchTracks('token','genre:"rock"');p.finish(null,0);activeGenerationProgress=null;
    return {length:items.length,page:p.report().searchEffectiveness.pages[0]};
  });assert.equal(r.length,0);assert.equal(r.page.raw,null);assert.equal(r.page.nameRejected,null);assert.equal(r.page.total,null);
});
for (const people of [2,4]) test(`${people} osoby: diagnostyka zachowuje ID, wyniki, kolejność, pule i transport względem Q1.3`, async () => {
  const r = await evaluate(async ({baseline,people}) => {
    const current=Object.fromEntries(Object.keys(baseline.functions).map(n=>[n,window[n]]));
    const now=Date.now();Date.now=()=>now;
    const selected=['bartek','asia','edyta','monika'].slice(0,people).map(id=>({id,name:profiles[id].name,artists:[],genres:['rock'],categories:[],blockedArtists:[],taste:{hasSurvey:true,likedGenres:['Rock']}}));
    const make=(id,artist)=>({id,uri:`spotify:track:${id}`,name:`Song ${id}`,artists:[{id:artist,name:artist}]});
    const tracks=Array.from({length:16},(_,i)=>make(`t${i}`,`a${Math.floor(i/3)}`));
    const initial=tracks.slice(0,10).map(track=>({track,queries:['genre:"rock"'],savedAt:now}));
    localStorage.setItem(LASTFM_TRACK_POOL_KEY,JSON.stringify(tracks.map(t=>({artist:t.artists[0].name,track:t.name,tags:['rock'],savedAt:now}))));
    waitForSearchSlot=async()=>{};const results=[];
    for(const policy of ['baseline','current']) {
      for(const [name,fn] of Object.entries(policy==='baseline'?baseline.functions:current))window[name]=typeof fn==='string'?(0,eval)(`(${fn})`):fn;
      localStorage.setItem(CANDIDATE_POOL_KEY,JSON.stringify(initial));localStorage.removeItem(searchCacheKey('genre:"rock"',0));newSearchesThisGeneration=0;
      let calls=0;fetch=async()=>{calls++;return Response.json({tracks:{total:17,items:[...tracks.slice(8),tracks[10]]}});};
      const p=OmmGenerationProgress.create(progressBox,60);activeGenerationProgress=p;p.stage(5);
      await searchTracks('token','genre:"rock"');
      const rows=loadCandidatePool(),ctx=buildGroupRecommendationContext(selected,rows,createLastFmEvidenceSnapshot());
      const {eligible,stats}=eligibleGroupCandidates(selected,generationBlocklists(selected),ctx,rows,rows,p.searchAudit);
      Math.random=()=>.25;const result=selectGroupPlaylist(eligible,12,ctx,stats);const final=sequencePlaylistForListening(result.tracks,5);
      p.searchAudit.finish(ctx.poolByTrack,eligible,final,acquisitionQualifying,trackArtistKeys);p.finish(null,final.length);activeGenerationProgress=null;
      results.push({calls,searches:newSearchesThisGeneration,ids:final.map(t=>t.id),scores:eligible.map(i=>[i.track.id,i.byUser,i.groupBase]),stats:result.rejectionStats,pool:loadCandidatePool(),audit:p.report().searchEffectiveness});
    }
    return results;
  },{baseline,people});
  const [{audit:old,...before},{audit:after,...next}]=r;assert.deepEqual(next,before);assert.equal(next.calls,1);assert.ok(next.ids.length>0);assert.equal(after.pages[0].added,6);assert.equal(after.pages[0].updated,2);assert.equal(after.pages[0].raw,9);assert.ok(after.pages[0].safe>0);assert.equal(after.pages[0].selected,next.ids.filter(id=>['t8','t9','t10','t11','t12','t13','t14','t15'].includes(id)).length);
});
test('szczegóły Search nie trafiają do LOG1, eksportu preferencji ani synchronizacji', async () => {
  const r=await evaluate(()=>{
    const p=OmmGenerationProgress.create(progressBox,60);p.stage(0);const row=p.searchAudit.begin('artist:"PRIVATE_QUERY_MARKER"',0,'Artyści wzorcowi','Spotify');p.searchAudit.response(row,0,[],0);p.finish(null,0);
    const entry=OfficeGenerationLog.build(p.report(),{id:crypto.randomUUID(),requested:60,profiles:[],group:null,cloud:{state:'not_run',lastfm:OfficeGenerationLog.emptyLastfm()}});
    return {valid:OfficeGenerationLog.valid(entry),entry,local:exportedStorageState(),text:progressBox.textContent};
  });assert.equal(r.valid,true);assert.ok(!JSON.stringify(r.entry).includes('PRIVATE_QUERY_MARKER'));assert.ok(!JSON.stringify(r.local).includes('PRIVATE_QUERY_MARKER'));assert.match(r.text,/PRIVATE_QUERY_MARKER/);
});
