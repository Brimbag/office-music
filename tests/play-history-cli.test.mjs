import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditBackup,parsePlaylistText,selectPlaylist,csv} from '../scripts/audit-play-history.mjs';
const rulesHtml=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const AT='2026-10-16T18:41:25.000Z',DAY=86400000;
const track={id:'same',name:'Fixture Song',artists:[{name:'Fixture Artist'}]};
const entry=(delta=2*DAY,source='spotify')=>({trackId:source==='spotify'?'same':'',trackName:'Fixture Song',artistNames:['Fixture Artist'],
  trackSignature:'fixture artist|fixture song',playedAt:new Date(Date.parse(AT)-delta).toISOString(),source});
const backup=history=>({exportedAt:'2026-10-16T14:34:51.329Z',source:'Office Music Mixer 1.0.12',storage:{office_music_history_v1:JSON.stringify(history)}});
test('offline audit: ID and Last.fm signatures, expiry, both sources, later plays ignored',()=>{
  const history=[entry(),entry(2*DAY,'lastfm'),{...entry(20*DAY),trackId:'old',trackName:'Old',trackSignature:'fixture artist|old'},
    {...entry(-DAY),trackId:'future',trackName:'Future',trackSignature:'fixture artist|future'}];
  const playlist={generatedAt:AT,tracks:[track,{...track,id:'old',name:'Old'},{...track,id:'future',name:'Future'},{...track,id:'absent',name:'Absent'}]};
  const r=auditBackup({backup:backup(history),playlist,rulesHtml});
  assert.equal(r.summary.tracks,4);assert.equal(r.summary.expectedExclusions,1);assert.equal(r.summary.sharePercent,25);
  assert.deepEqual(r.rows[0].methods,['id','signature']);assert.deepEqual(r.rows[0].sources,['lastfm','spotify']);
  assert.equal(r.rows[1].finding,'outside_14_day_window');assert.equal(r.rows[2].laterPlaysIgnored,1);
  assert.equal(r.rows[2].shouldExclude,false);assert.equal(r.rows[3].finding,'no_prior_play_found_in_supplied_backup');
  assert.equal(r.summary.confirmedGenerationBypassCause,null);assert.ok(r.warnings.includes('backup_precedes_generation_and_is_not_its_input_snapshot'));
});
test('text report parser verifies count, resolves artist credits without inventing playlist IDs, converts PL time',()=>{
  const b=backup([entry()]);b.storage.office_candidate_pool_v1=JSON.stringify([{track:{...track,artists:[{name:'Fixture Artist'},{name:'Second Artist'}]}}]);
  const text='1.0.13 · 1/150 utworów · gotowe\nKopia lokalna · koniec: 16.10.2026, 20:41:25\nHistoria lokalna: 1500 wpisów (1044 z Last.fm, 456 ze Spotify)\nFixture Artist, Second Artist - Fixture Song\nSpotify: genre:"rock"\n👍';
  const p=parsePlaylistText(text,b);assert.equal(p.generatedAt,AT);assert.equal(p.tracks[0].id,'');
  assert.deepEqual(p.tracks[0].artists,[{name:'Fixture Artist'},{name:'Second Artist'}]);
  const r=auditBackup({backup:b,playlist:p,rulesHtml});assert.equal(r.summary.expectedExclusions,1);
  assert.deepEqual(r.rows[0].methods,['signature']);assert.ok(r.warnings.includes('reported_history_counts_differ_from_backup'));
  assert.throws(()=>parsePlaylistText(text.replace('1/150','2/150'),b),/Liczba/);
});
test('ambiguous Warsaw DST time requires an explicit offset; never guesses the generation clock',()=>{
  const text='1.0.13 · 1/150 utworów\nkoniec: 25.10.2026, 02:30:00\nFixture Artist - Fixture Song\nSpotify: rock';
  assert.throws(()=>parsePlaylistText(text,backup([])),/Niejednoznaczny/);
  const p=parsePlaylistText(text,backup([]),{generatedAt:'2026-10-25T02:30:00+01:00'});
  assert.equal(p.generatedAt,'2026-10-25T02:30:00+01:00');assert.equal(p.reportedGeneratedAt,null);
});
test('playlist selection never assumes an added_at timestamp is generation time or silently chooses a snapshot',()=>{
  const recent=[{id:'one',generatedAt:AT,tracks:[track]},{id:'two',generatedAt:AT,tracks:[track]}];
  const b={storage:{office_recent_playlists_v1:JSON.stringify(recent)}};
  assert.throws(()=>selectPlaylist(b),/playlist-id/);assert.equal(selectPlaylist(b,{playlistId:'one'}).id,'one');
  const p=selectPlaylist({tracks:{items:[{added_at:AT,track}]}});assert.equal(p.generatedAt,undefined);
  assert.throws(()=>auditBackup({backup:backup([]),playlist:p,rulesHtml}),/timestamp/);
});
test('audit normalizes missing signatures, retains valid rows next to corrupt data, CSV escapes quotes/newlines',()=>{
  const row=entry(2*DAY,'lastfm');delete row.trackSignature;
  const r=auditBackup({backup:backup([row,{...entry(),trackName:{invalid:true},artistNames:[null],trackId:'bad',trackSignature:null}]),
    playlist:{generatedAt:AT,tracks:[track]},rulesHtml});
  assert.equal(r.summary.expectedExclusions,1);assert.equal(r.rows[0].currentFilterExcludes,true);
  assert.match(csv([{position:1,title:'A "quote"\nsecond line'}]),/"A ""quote""\nsecond line"/);
});
function withRegister(history=[],at=Date.parse(AT)-2*DAY){
  const b=backup(history);
  b.storage[OfficePlayCooldown.localKey('fixtureOwner')]=JSON.stringify({version:1,account:'fixtureOwner',
    tracks:{same:at},signatures:{'fixture artist|fixture song':at}});
  return b;
}
test('audit includes shared play IDs and signatures even without local history',()=>{
  const r=auditBackup({backup:withRegister(),playlist:{generatedAt:AT,tracks:[track,{...track,id:'edition'}]},rulesHtml});
  assert.equal(r.summary.playRegisters,1);assert.equal(r.summary.expectedExclusions,2);
  assert.deepEqual(r.rows[0].registryMethods,['id','signature']);assert.deepEqual(r.rows[1].registryMethods,['signature']);
  assert.ok(r.rows.every(row=>row.currentFilterExcludes&&row.finding==='active_play_registry_block'));
});
for(const age of [14*DAY-1,14*DAY,14*DAY+1,-DAY])test(`registry audit respects exact age ${age} and ignores later plays`,()=>{
  const r=auditBackup({backup:withRegister([],Date.parse(AT)-age),playlist:{generatedAt:AT,tracks:[track]},rulesHtml});
  assert.equal(r.rows[0].shouldExclude,age>=0&&age<14*DAY);
  assert.equal(r.rows[0].currentFilterExcludes,age>=0&&age<14*DAY);
  assert.equal(r.warnings.includes('registry_contains_later_timestamps_earlier_plays_cannot_be_reconstructed'),age<0);
});
test('audit rejects malformed or ambiguous account registers instead of ignoring cloud blocks',()=>{
  const b=withRegister();b.storage[OfficePlayCooldown.localKey('otherOwner')]=JSON.stringify(OfficePlayCooldown.empty('otherOwner'));
  assert.throws(()=>auditBackup({backup:b,playlist:{generatedAt:AT,tracks:[track]},rulesHtml}),/wielu kont/);
  delete b.storage[OfficePlayCooldown.localKey('otherOwner')];b.storage[OfficePlayCooldown.localKey('fixtureOwner')]='{broken';
  assert.throws(()=>auditBackup({backup:b,playlist:{generatedAt:AT,tracks:[track]},rulesHtml}));
});
