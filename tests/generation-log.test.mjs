import test from 'node:test';import assert from 'node:assert/strict';import {entry} from './helpers/generation-log.mjs';
const log=OfficeGenerationLog;
test('LOG1 aggregate success and failed/partial generation schemas',()=>{
 assert.equal(log.valid(entry()),true);
 for(const created of [false,true]){const e=entry();Object.assign(e,{outcome:'error',length:0,playlistCreated:created,selection:null,cloud:{state:'not_run',lastfm:log.emptyLastfm()}});assert.equal(log.valid(e),true);}
});
for(const field of ['access_token','refresh_token','history','query','account_id','trackName','artistId'])test(`LOG1 rejects private/unknown field ${field}`,()=>{const e=entry();e[field]='secret';assert.equal(log.valid(e),false);});
for(const kind of ['negative','nan','overlong','unknown-profile','duplicate-profile','bad-date','too-many-discoveries','bad-metric','unknown-metric','secret-in-filter','bad-lastfm-count','unknown-stage'])test(`LOG1 invalid ${kind}`,()=>{
 const e=entry();if(kind==='negative')e.totalMs=-1;if(kind==='nan')e.totalMs=NaN;if(kind==='overlong')e.version='x'.repeat(20000);if(kind==='unknown-profile')e.profiles=['other'];if(kind==='duplicate-profile')e.profiles=['bartek','bartek'];if(kind==='bad-date')e.finishedAt='2026-02-30T00:00:00.000Z';if(kind==='too-many-discoveries')e.selection.discovery=49;if(kind==='bad-metric')e.metrics.spotifyApi.exclusiveMs=5000;if(kind==='unknown-metric')e.metrics.secret={calls:1,inclusiveMs:1,exclusiveMs:1};if(kind==='secret-in-filter')e.selection.filters.token='secret';if(kind==='bad-lastfm-count')e.cloud.lastfm.artists=1801;if(kind==='unknown-stage')e.stages[0].status='active';assert.equal(log.valid(e),false);
});
test('LOG1 explicit builder strips messages, names, tokens, queries and raw group data',()=>{
 const report={outcome:'success',length:48,playlistCreated:true,totalMs:10.123,stages:Array.from({length:11},()=>({status:'done',ms:1,name:'secret'})),counters:{searches:1,query:'secret'},metrics:{spotifyApi:{calls:1,inclusiveMs:1,exclusiveMs:1},query:'secret'},warnings:['secret'],error:'secret'};
 const context={id:entry().id,requested:60,profiles:['bartek'],cloud:entry().cloud,group:{tracks:[{id:'secret',name:'secret',artists:[{id:'secret',name:'secret'}]}],discoveryCount:13,discoveryQuota:{max:16},satisfaction:{bartek:{average:65,strong:17,weak:0,name:'secret'}},rejectionStats:{rawPool:2000,query:'secret'}}};
 const e=log.build(report,context);assert.equal(log.valid(e),true);assert.equal(JSON.stringify(e).includes('secret'),false);assert.equal(e.totalMs,10.12);assert.equal(e.selection.distinctArtists,1);
});
test('LOG1 reports actual Last.fm write/read/skip/error separately from preference upload',()=>{
 assert.deepEqual(log.cloudResult(null,true),{state:'error',lastfm:log.emptyLastfm()});
 assert.equal(log.cloudResult({catalog:{error:'secret'}}).lastfm.status,'error');assert.equal(JSON.stringify(log.cloudResult({catalog:{error:'secret'}})).includes('secret'),false);
 const lf=log.cloudResult({catalog:{artists:1,tracks:2,bytes:100,written:true}}).lastfm;assert.equal(lf.written,true);assert.equal(lf.status,'success');
 assert.equal(log.cloudResult({catalog:{skipped:true,artists:1,tracks:2,bytes:100,written:false}}).lastfm.status,'skipped');
});

test('LOG1 release candidate version preserves legacy cloud log compatibility',()=>{
 for(const version of ['v43.41.S2','v43.25.U1','v1.0.0-rc.1']){const e=entry();e.version=version;assert.equal(log.valid(e),true);}
 for(const version of ['v1.0.0-rc.1 token','v1.0.0-rc.','v1.0.0-rc.1234','secret']){const e=entry();e.version=version;assert.equal(log.valid(e),false);}
});
