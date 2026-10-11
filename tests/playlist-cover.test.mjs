import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { startBrowserHarness } from './helpers/browser.mjs';
const context = vm.createContext({ URL, AbortController, setTimeout, clearTimeout });
vm.runInContext(readFileSync(new URL('../playlist-cover.js', import.meta.url), 'utf8'), context);
const cover = context.OfficePlaylistCover;
const track = (id, image = id) => ({ id, album: { images: image ? [{ url: `https://i.scdn.co/image/${image}`, width: 300 }] : [] } });
const selected = (tracks, scores) => Array.from(cover.choose(tracks, new Map(tracks.map((t, i) => [t.id, { final: scores[i] }]))), t => t.id);
test('cover uses existing final fit, not shuffled playlist order; input unchanged', () => {
  const tracks = ['d','a','c','b','e'].map(id => track(id)); const before = JSON.stringify(tracks);
  assert.deepEqual(selected(tracks, [5,100,20,90,0]), ['a','b','c','d']); assert.equal(JSON.stringify(tracks), before);
});
test('different artwork preferred before duplicate, even for a lower score', () => {
  assert.deepEqual(selected([track('a','same'),track('b','same'),track('c'),track('d'),track('e')], [100,99,98,97,96]), ['a','c','d','e']);
});
test('missing artwork does not displace a higher-scoring legacy track before metadata lookup', () => {
  assert.deepEqual(selected([track('a',null),track('b'),track('c'),track('d'),track('e')], [100,99,98,97,96]), ['a','b','c','d']);
});
test('ties deterministic regardless of input order, missing scores safe', () => {
  assert.deepEqual(selected([track('b'),track('a')], [80,80]), ['a','b']);
  assert.deepEqual(selected([track('b'),track('a')], [undefined,undefined]), ['a','b']);
});
for (const count of [0,1,2,3,4]) test(`short playlist: ${count} tracks, no synthetic track added`, () => {
  const tracks = Array.from({ length: count }, (_, i) => track(String(i), null));
  assert.equal(cover.choose(tracks, new Map()).length, count);
});
test('initials: Polish names, whitespace, duplicate initials and missing names', () => {
  assert.equal(cover.initials([{name:' Asia '},{name:'łukasz'},{name:'Anna'},{name:''},{}]), 'A • Ł • A');
});
test('only HTTPS Spotify album CDN artwork accepted', () => {
  for (const url of ['http://i.scdn.co/image/a','https://evil.example/a','data:image/png;base64,x','invalid']) assert.equal(cover.imageFor({album:{images:[{url}]}}), '');
  assert.equal(cover.imageFor({album:{images:{bad:true}}}), '');
  assert.equal(cover.imageFor(track('a')), 'https://i.scdn.co/image/a');
});
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function browser(run, arg) {
  const session = await harness.page();
  try {
    const png = await session.page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 10; const x = c.getContext('2d'); x.fillStyle = '#ee0000'; x.fillRect(0,0,10,10); return c.toDataURL().split(',')[1]; });
    await session.page.route('https://i.scdn.co/**', route => route.fulfill({status:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:'image/png', body:Buffer.from(png,'base64')}));
    const result = await session.page.evaluate(run, arg); assert.deepEqual(session.errors, []); return result;
  } finally { await session.close(); }
}
test('real Canvas JPEG: square, footer outside artwork, empty cells and readable labels', async () => {
  const result = await browser(async () => {
    const text = [], draws = [], original = CanvasRenderingContext2D.prototype.fillText, draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.fillText = function(...args) { text.push(args); return original.apply(this,args); };
    CanvasRenderingContext2D.prototype.drawImage = function(...args) { draws.push(args.slice(1)); return draw.apply(this,args); };
    try {
      const body = await OfficePlaylistCover.render([{album:{images:[{url:'https://i.scdn.co/image/a'}]}}], [{name:'Asia'},{name:'Bartek'}], new AbortController().signal);
      const image = new Image(); image.src = `data:image/jpeg;base64,${body}`; await image.decode();
      return { length:body.length, prefix:body.slice(0,4), width:image.width, height:image.height, text:text.map(x=>x[0]), draws };
    } finally { CanvasRenderingContext2D.prototype.fillText = original; CanvasRenderingContext2D.prototype.drawImage = draw; }
  });
  assert.equal(result.width,512); assert.equal(result.height,512); assert.ok(result.length <= 256000); assert.equal(result.prefix,'/9j/');
  assert.deepEqual(result.text,['A • B','OMM']); assert.equal(result.draws.length,1); assert.ok(result.draws[0][1]+result.draws[0][3]<=448);
});
test('successful upload: exactly one PUT with raw base64 JPEG, no selection mutation', async () => {
  const result = await browser(async () => {
    const tracks = [{id:'a',album:{images:[{url:'https://i.scdn.co/image/a'}]}}], before = JSON.stringify(tracks), calls=[];
    const ok = await OfficePlaylistCover.apply({token:'test',playlistId:'p',tracks,details:new Map([['a',{final:90}]]),people:[{name:'Asia'}],request:async (_token,url,options)=>{calls.push({url,method:options.method,type:options.headers['Content-Type'],body:options.body.slice(0,4)});return new Response(null,{status:202});}});
    return {ok,calls,unchanged:before===JSON.stringify(tracks)};
  });
  assert.equal(result.ok,true); assert.equal(result.unchanged,true); assert.deepEqual(result.calls,[{url:'https://api.spotify.com/v1/playlists/p/images',method:'PUT',type:'image/jpeg',body:'/9j/'}]);
});
for (const status of [401,403,429,500,'network']) test(`cover error ${status}: best effort, no automatic write replay`, async () => {
  const result = await browser(async status => {
    let calls=0;
    const ok = await OfficePlaylistCover.apply({token:'test',playlistId:'p',tracks:[{id:'a',album:{images:[{url:'https://i.scdn.co/image/a'}]}}],details:new Map(),people:[],request:async ()=>{calls++;if(status==='network')throw new Error('offline');return new Response(null,{status});}});
    return {ok,calls};
  },status);
  assert.deepEqual(result,{ok:false,calls:1});
});
test('legacy pool: max four metadata reads, images restored only to cover copies', async () => {
  const result = await browser(async () => {
    const tracks = Array.from({length:10},(_,i)=>({id:String(i),album:{name:'legacy'}})), before=JSON.stringify(tracks), calls=[];
    const ok=await OfficePlaylistCover.apply({token:'test',playlistId:'p',tracks,details:new Map(),people:[],request:async (_token,url,options={})=>{calls.push(options.method||'GET');return options.method==='PUT'?new Response(null,{status:202}):Response.json({album:{images:[{url:'https://i.scdn.co/image/a'}]}});}});
    return {ok,calls,unchanged:before===JSON.stringify(tracks)};
  });
  assert.equal(result.ok,true); assert.equal(result.unchanged,true); assert.deepEqual(result.calls,['GET','GET','GET','GET','PUT']);
});
test('all images missing: keep default Spotify cover, no upload', async () => {
  const result=await browser(async()=>{let calls=0;const ok=await OfficePlaylistCover.apply({token:'test',playlistId:'p',tracks:[{id:'a'}],details:new Map(),people:[],request:async()=>{calls++;return new Response(null,{status:404});}});return {ok,calls};});
  assert.deepEqual(result,{ok:false,calls:1});
});
test('timeout cancels metadata request and never starts late upload', async () => {
  const result=await browser(async()=>{let calls=0;const ok=await OfficePlaylistCover.apply({token:'test',playlistId:'p',tracks:[{id:'a'}],details:new Map(),people:[],timeoutMs:10,request:async(_token,_url,{signal})=>{calls++;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));throw new Error('aborted');}});return {ok,calls};});
  assert.deepEqual(result,{ok:false,calls:1});
});
test('slim metadata preserves one image; OAuth requests image scope; only generator starts cover', async () => {
  const result=await browser(()=>({album:slimTrack({album:{name:'Album',images:[{url:'https://i.scdn.co/image/a'},{url:'https://i.scdn.co/image/b'}]}}).album,scope:scopes.includes('ugc-image-upload')}));
  assert.deepEqual(result,{album:{name:'Album',images:[{url:'https://i.scdn.co/image/a'}]},scope:true});
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.equal((source.match(/OfficePlaylistCover.apply\(/g)||[]).length,1);
  assert.ok(source.indexOf('OfficePlaylistCover.apply(')>source.indexOf('    renderPlaylistResult(\n      playlist,'));
});
for (const people of [2,4]) test(`${people} profiles: artwork metadata cannot change eligibility, scores or shuffled order`, async () => {
  const result=await browser(people=>{
    const selected=['bartek','asia','edyta','monika'].slice(0,people).map(id=>({id,name:profiles[id].name,genres:['rock'],artists:[],categories:[],blockedArtists:[],taste:{hasSurvey:true,likedGenres:['Rock'],okGenres:[],blockedGenres:[]}}));
    const tracks=Array.from({length:8},(_,i)=>({id:`track${i}`,uri:`spotify:track:track${i}`,name:`Song ${i}`,artists:[{id:`artist${Math.floor(i/2)}`,name:`Artist ${Math.floor(i/2)}`}],album:{name:'Album'}}));
    addLastFmTracks(tracks.map(t=>({name:t.name,artist:{name:t.artists[0].name}})),{tags:['rock']});
    const run=withImages=>{
      saveCandidatePool(tracks.map(t=>({track:withImages?{...t,album:{...t.album,images:[{url:`https://i.scdn.co/image/${t.id}`}]}}:t,queries:['genre:"rock"'],savedAt:Date.now()})));
      const ctx=buildGroupRecommendationContext(selected),{eligible,stats}=eligibleGroupCandidates(selected,generationBlocklists(selected),ctx);
      Math.random=()=>0.25;
      const result=selectGroupPlaylist(eligible,8,ctx,stats);
      return {eligible:eligible.map(t=>t.track.id),details:[...result.details],order:sequencePlaylistForListening(result.tracks,5).map(t=>t.id),discovery:result.discoveryCount};
    };
    return {without:run(false),with:run(true)};
  },people);
  assert.ok(result.without.order.length>0);assert.deepEqual(result.with,result.without);
});
test('metadata reveals duplicates: use another available album rather than repeat four images', async () => {
  const result=await browser(async()=>{
    const tracks=Array.from({length:5},(_,i)=>({id:String(i),album:i===4?{images:[{url:'https://i.scdn.co/image/other'}]}:{}}));
    const details=new Map(tracks.map((t,i)=>[t.id,{final:100-i}])), images=[], original=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(image,...rest){images.push(image.src);return original.call(this,image,...rest);};
    try {const ok=await OfficePlaylistCover.apply({token:'test',playlistId:'p',tracks,details,people:[],request:async(_token,_url,options={})=>options.method==='PUT'?new Response(null,{status:202}):Response.json({album:{images:[{url:'https://i.scdn.co/image/same'}]}})});return {ok,images};}
    finally{CanvasRenderingContext2D.prototype.drawImage=original;}
  });
  assert.equal(result.ok,true);assert.equal(result.images.length,4);assert.equal(new Set(result.images).size,2);
});
test('Canvas security/serialization failure never uploads a broken cover', async()=>{
  const result=await browser(async()=>{
    const original=HTMLCanvasElement.prototype.toDataURL;let calls=0;
    HTMLCanvasElement.prototype.toDataURL=()=>{throw new DOMException('Tainted canvas','SecurityError');};
    try {const ok=await OfficePlaylistCover.apply({token:'test',playlistId:'p',tracks:[{id:'a',album:{images:[{url:'https://i.scdn.co/image/a'}]}}],details:new Map(),people:[],request:async()=>{calls++;return new Response(null,{status:202});}});return {ok,calls};}
    finally{HTMLCanvasElement.prototype.toDataURL=original;}
  });
  assert.deepEqual(result,{ok:false,calls:0});
});
