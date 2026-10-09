import test from 'node:test';
import assert from 'node:assert/strict';
import '../lastfm-sync.js';
const {assess, notice, TTL} = globalThis.OmmLastFmSync;
const now = Date.UTC(2026,9,9,12);
const row = (i, sourceAccount = 'spotify-one') => ({trackId:`id${i}`,trackName:`Song ${i}`,artistNames:['Artist'],sourceAccount,durationMs:240000,playedAt:new Date(now - (120 - i * 10) * 60000).toISOString()});
const base = () => ({user:'lf-one',account:'spotify-one',now,spotify:Array.from({length:6},(_,i)=>row(i)),lastfm:[],spotifyObservation:{account:'spotify-one',observedAt:now},lastfmObservation:{user:'lf-one',observedAt:now,complete:true}});
const aligned = b => b.lastfm = b.spotify.map(r => ({...r,sourceAccount:'lf-one'}));
test('healthy: recent matching observations; no selection mutation',()=>{const b=base();aligned(b);const before=JSON.stringify(b);assert.equal(assess(b).status,'healthy');assert.equal(JSON.stringify(b),before);});
test('six consecutive misses spanning 50 minutes: suspicion',()=>assert.equal(assess(base()).status,'suspected_issue'));
for(const scenario of ['none','fresh','single','old','stale','future','partial','foreign']) test(`no false alarm: ${scenario}`,()=>{
 const b=base();
 if(scenario==='none') b.spotify=[];
 if(scenario==='fresh') b.spotify=b.spotify.map(r=>({...r,playedAt:new Date(now-60000).toISOString()}));
 if(scenario==='single') b.spotify=b.spotify.slice(0,1);
 if(scenario==='old') b.spotify=b.spotify.map(r=>({...r,playedAt:new Date(now-86400000).toISOString()}));
 if(scenario==='stale') b.spotifyObservation.observedAt=now-TTL-1;
 if(scenario==='future') b.lastfmObservation.observedAt=now+1;
 if(scenario==='partial') b.lastfmObservation.complete=false;
 if(scenario==='foreign') b.spotify=b.spotify.map(r=>({...r,sourceAccount:'other'}));
 assert.equal(assess(b).status,'insufficient_data');
});
test('API failure separate from stopped scrobbling',()=>{for(const key of ['spotifyObservation','lastfmObservation']){const b=base();b[key].error=true;assert.equal(assess(b).status,'api_error');}});
test('configuration and account isolation',()=>{const b=base();b.user='';assert.equal(assess(b).status,'not_configured');b.user='other';assert.equal(assess(b).status,'insufficient_data');});
test('delayed Last.fm data clears suspicion',()=>{const b=base();const bad=assess(b);aligned(b);const healthy=assess(b);assert.equal(healthy.status,'healthy');assert.equal(notice(notice(null,bad,now),healthy,now+100),null);});
test('case, spacing, remaster and featured suffix; start/end timestamp tolerance',()=>{
 const b=base();aligned(b);b.lastfm=b.lastfm.map(r=>({...r,trackName:` ${r.trackName.toUpperCase()} - 2011 Remaster`,artistNames:['  ARTIST  '],playedAt:new Date(Date.parse(r.playedAt)-240000).toISOString()}));
 assert.equal(assess(b).status,'healthy');
 b.lastfm=b.lastfm.map(r=>({...r,trackName:r.trackName.replace(' - 2011 Remaster',' (feat. Guest)')}));assert.equal(assess(b).status,'healthy');
});
test('live and Rework remain different recordings',()=>{const b=base();aligned(b);b.lastfm=b.lastfm.map(r=>({...r,trackName:`${r.trackName} (Live)`}));assert.equal(assess(b).status,'suspected_issue');});
test('one-to-one matching cannot reuse a scrobble for six plays',()=>{
 const b=base();b.spotify=b.spotify.map(r=>({...r,trackName:'Same'}));b.lastfm=[{...b.spotify[0],sourceAccount:'lf-one'}];const r=assess(b);assert.equal(r.matched,1);assert.equal(r.missing,5);
});
test('recent matched play breaks missing streak',()=>{const b=base();b.lastfm=[{...b.spotify.at(-1),sourceAccount:'lf-one'}];assert.equal(assess(b).status,'healthy');});
test('duplicate Spotify observations do not manufacture a streak',()=>{const b=base();b.spotify=Array(6).fill(b.spotify[0]);assert.equal(assess(b).status,'insufficient_data');});
test('partial coverage only evaluates the covered interval',()=>{const b=base();b.lastfmObservation.complete=false;b.lastfmObservation.oldest=now-50*60000;assert.equal(assess(b).status,'insufficient_data');});
test('dismissal survives renders and moving history window; recovery allows a new incident',()=>{
 const r=assess(base());let n=notice(null,r,now);n.dismissed=true;
 assert.equal(notice(n,r,now+1).dismissed,true);assert.equal(notice(n,{...r,incident:'shifted'},now+100).dismissed,true);
 assert.equal(notice(n,{...r,status:'api_error'},now+200).dismissed,true);
 n=notice(n,{...r,status:'healthy'},now+300);assert.equal(n,null);assert.equal(notice(n,{...r,incident:'new'},now+400).dismissed,false);
});
test('five misses require the 30-minute span, including exact boundary',()=>{const b=base();b.spotify=b.spotify.slice(0,5).map((r,i)=>({...r,playedAt:new Date(now-90*60000+i*7.5*60000).toISOString()}));assert.equal(assess(b).status,'suspected_issue');b.spotify[4].playedAt=new Date(Date.parse(b.spotify[4].playedAt)-1).toISOString();assert.equal(assess(b).status,'insufficient_data');});
test('truncated local history and empty partial pages cannot establish an outage',()=>{const b=base();b.lastfmObservation.count=20;assert.equal(assess(b).status,'insufficient_data');delete b.lastfmObservation.count;b.lastfmObservation.complete=false;b.lastfmObservation.oldest=null;assert.equal(assess(b).status,'insufficient_data');});
test('dismissal expires after 24 hours without continuous alerts',()=>{const r=assess(base());const n={...notice(null,r,now),dismissed:true};assert.equal(notice(n,r,now+86400000-1).dismissed,true);assert.equal(notice(n,r,now+86400000).dismissed,false);});
