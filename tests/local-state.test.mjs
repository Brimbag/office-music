import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
let harness;
before(async()=>{harness=await startBrowserHarness();});
after(async()=>{await harness.close();});
async function run(fn){const tab=await harness.page();try{return await fn(tab.page);}finally{await tab.close();}}

test('L1: walidacja odrzuca null, obce klucze i złe struktury przed zapisem',()=>run(async page=>{
 const result=await page.evaluate(()=>{
  const bad=[null,{format:'office-music-state',version:1,storage:[]},...[
   {'spotify_access_token':'secret'}, {'office_music_history_v1':'{}'}, {'office_feedback_v1':'[]'}, {'office_taste_profile_v1':'{"version":1,"people":[]}'}, {'office_seed_bartek':null}
  ].map(storage=>({format:'office-music-state',version:1,storage}))];
  return bad.map(x=>{try{OmmLocalState.validate(x);return false;}catch{return true;}});
 });assert.ok(result.every(Boolean));
}));
test('L1: quota usuwa wyłącznie raw cache, zachowuje historię, pule i OAuth',()=>run(async page=>{
 assert.deepEqual(await page.evaluate(()=>{
  localStorage.setItem('office_search_cache_v1:q','cache');localStorage.setItem('office_music_history_v1','[]');localStorage.setItem('spotify_access_token','secret');
  const original=Storage.prototype.setItem;let failed=false;
  Storage.prototype.setItem=function(k,v){if(k==='office_seed_bartek'&&!failed){failed=true;throw new DOMException('full','QuotaExceededError');}return original.call(this,k,v);};
  try{OmmLocalState.write('office_seed_bartek','new');}finally{Storage.prototype.setItem=original;}
  return [localStorage.getItem('office_search_cache_v1:q'),localStorage.getItem('office_music_history_v1'),localStorage.getItem('spotify_access_token'),localStorage.getItem('office_seed_bartek')];
 }),[null,'[]','secret','new']);
}));
test('L1: trwała quota nie nadpisuje wcześniejszej preferencji i pokazuje błąd',()=>run(async page=>{
 const result=await page.evaluate(()=>{
  localStorage.setItem('office_seed_bartek','old');const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,v){if(k==='office_seed_bartek')throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};
  let rejected=false;try{OmmLocalState.write('office_seed_bartek','new');}catch{rejected=true;}finally{Storage.prototype.setItem=original;}
  return [rejected,localStorage.getItem('office_seed_bartek'),document.querySelector('#localStateNotice').textContent];
 });assert.equal(result[0],true);assert.equal(result[1],'old');assert.match(result[2],/Nie zapisano/);
}));
test('L1: udany import zachowuje trwałą kopię bez tokenów',()=>run(async page=>{
 const result=await page.evaluate(async()=>{
  localStorage.setItem('office_seed_bartek','old');localStorage.setItem('spotify_access_token','secret');const before=OmmLocalState.snapshot();
  await OmmLocalState.importState({'office_seed_bartek':'new'});const backup=await OmmLocalState.record();
  return {before,backup,now:localStorage.getItem('office_seed_bartek'),token:localStorage.getItem('spotify_access_token'),blocked:OmmLocalState.blocked};
 });assert.deepEqual(result.backup.storage,result.before);assert.equal(result.backup.pending,false);assert.equal(result.now,'new');assert.equal(result.token,'secret');assert.equal(result.blocked,false);assert.ok(!('spotify_access_token' in result.backup.storage));
}));
test('L1: błąd w połowie importu przywraca dokładny stan',()=>run(async page=>{
 const result=await page.evaluate(async()=>{
  localStorage.setItem('office_seed_bartek','old');const before=OmmLocalState.snapshot();const original=Storage.prototype.setItem;let failed=false;
  Storage.prototype.setItem=function(k,v){if(k==='office_seed_edyta'&&!failed){failed=true;throw new DOMException('full','QuotaExceededError');}return original.call(this,k,v);};
  let rejected=false;try{await OmmLocalState.importState({'office_seed_bartek':'new','office_seed_edyta':'new'});}catch{rejected=true;}finally{Storage.prototype.setItem=original;}
  return {before,after:OmmLocalState.snapshot(),rejected,blocked:OmmLocalState.blocked,backup:await OmmLocalState.record()};
 });assert.deepEqual(result.after,result.before);assert.equal(result.rejected,true);assert.equal(result.blocked,false);assert.equal(result.backup.pending,false);
}));
test('L1: awaria rollbacku blokuje zapisy; reload odzyskuje trwałą kopię',()=>run(async page=>{
 const before=await page.evaluate(async()=>{
  localStorage.setItem('office_seed_bartek','old');const state=OmmLocalState.snapshot();const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,v){if(k.startsWith('office_'))throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};
  try{await OmmLocalState.importState({'office_seed_bartek':'new'});}catch{}
  if(!OmmLocalState.blocked || !(await OmmLocalState.record()).pending)throw new Error('unsafe rollback');
  let rejected=false;try{OmmLocalState.write('office_seed_bartek','unsafe');}catch{rejected=true;}if(!rejected)throw new Error('unsafe write');
  return state;
 });await page.reload();await page.waitForFunction(()=>window.ommStorageReady===true);
 const result=await page.evaluate(async()=>({state:OmmLocalState.snapshot(),pending:(await OmmLocalState.record()).pending,blocked:OmmLocalState.blocked}));
 // Startup migrations may add derived keys, but every original value must survive.
 for(const [key,value] of Object.entries(before))assert.equal(result.state[key],value);
 assert.equal(result.pending,false);assert.equal(result.blocked,false);
}));
test('L1: brak IndexedDB przerywa import przed usunięciem danych',()=>run(async page=>{
 const result=await page.evaluate(async()=>{
  const before=OmmLocalState.snapshot();const original=indexedDB.open;indexedDB.open=()=>{throw new Error('unavailable');};let rejected=false;
  try{await OmmLocalState.importState({'office_seed_bartek':'new'});}catch{rejected=true;}finally{indexedDB.open=original;}
  return {before,after:OmmLocalState.snapshot(),rejected,blocked:OmmLocalState.blocked};
 });assert.deepEqual(result.after,result.before);assert.equal(result.rejected,true);assert.equal(result.blocked,false);
}));
test('L1: odzyskanie pustego stanu sprzed pierwszego importu',()=>run(async page=>{
 const result=await page.evaluate(async()=>{
  await OmmLocalState.record({format:'office-music-state',version:1,storage:{},pending:true});
  return {ok:await OmmLocalState.recover(),state:OmmLocalState.snapshot()};
 });assert.equal(result.ok,true);assert.deepEqual(result.state,{});
}));
test('L1: ankieta po quota przywraca ocenę w pamięci i nie pokazuje sukcesu',async()=>{
 const tab=await harness.page('/taste.html');try{
 const {page}=tab;await page.locator('[data-person="Bartek"]').click();await page.locator('.choices[data-id="rock"] .choice[data-val="like"]').click();
 const before=await page.evaluate(()=>localStorage.getItem('office_taste_profile_v1'));
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='office_taste_profile_v1')throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};});
 await page.locator('.choices[data-id="rock"] .choice[data-val="no"]').click();
 assert.equal(await page.evaluate(()=>localStorage.getItem('office_taste_profile_v1')),before);
 assert.equal(await page.locator('.choices[data-id="rock"] .choice[data-val="like"]').getAttribute('data-active'),'like');
 assert.match(await page.locator('#localStateNotice').textContent(),/Nie zapisano/);
 await page.waitForTimeout(1200);assert.equal(await page.getByText('Nie zapisano zmiany',{exact:true}).count(),1);
 }finally{await tab.close();}
});
test('L1: quota ustawień RMF bez wcześniejszego klucza nie powoduje rekurencji',()=>run(async page=>{
 const result=await page.evaluate(()=>{
  localStorage.removeItem(RMF_SETTINGS_KEY);const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,v){if(k===RMF_SETTINGS_KEY)throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};
  try{rmfEnabled.checked=false;return {saved:saveRmfSettings(),restored:rmfEnabled.checked};}finally{Storage.prototype.setItem=original;}
 });assert.deepEqual(result,{saved:false,restored:true});
}));
test('L1: nieudane odzyskiwanie blokuje generator i synchronizację',()=>run(async page=>{
 await page.evaluate(async()=>{await OmmLocalState.record({format:'office-music-state',version:1,storage:{'office_seed_bartek':'old'},pending:true});});
 await page.context().addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='office_seed_bartek')throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};});
 await page.reload();await page.waitForFunction(()=>window.ommStorageReady===true);
 const result=await page.evaluate(async()=>{
  let rejected=false;try{await uploadCloudStateIfChanged('mock',{force:true});}catch{rejected=true;}
  return {blocked:OmmLocalState.blocked,rejected,disabled:document.querySelector('#generateButton').disabled,backup:(await OmmLocalState.record()).storage};
 });assert.equal(result.blocked,true);assert.equal(result.rejected,true);assert.equal(result.disabled,true);assert.deepEqual(result.backup,{'office_seed_bartek':'old'});
}));
test('L1: niedostępna kopia przy pending nie pozwala uruchomić aplikacji z częściowym stanem',()=>run(async page=>{
 const result=await page.evaluate(async()=>{
  localStorage.setItem('omm_local_import_pending','1');const original=indexedDB.open;indexedDB.open=()=>{throw new Error('temporarily unavailable');};
  try{return {ok:await OmmLocalState.recover(),blocked:OmmLocalState.blocked};}finally{indexedDB.open=original;}
 });assert.deepEqual(result,{ok:false,blocked:true});
}));
