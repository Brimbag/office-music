import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserHarness} from './helpers/browser.mjs';
let harness;
before(async()=>{harness=await startBrowserHarness();});after(async()=>{await harness.close();});
async function pair(fn,first='/taste.html',second='/taste.html'){
 const tab=await harness.page(first);try{
 const other=await tab.page.context().newPage();await other.goto(new URL(second,tab.page.url()).href);await other.waitForFunction(()=>window.ommStorageReady===true);
 if (first==='/') await tab.page.evaluate(()=>{mixerBox.style.display="block";renderProfiles();});
 if (second==='/') await other.evaluate(()=>{mixerBox.style.display="block";renderProfiles();});
 await fn(tab.page,other);
 }finally{await tab.close();}
}
const db=()=>({version:1,taxonomyVersion:2,updatedAt:null,people:{Bartek:{genres:{rock:'like'}},Edyta:{genres:{}}}});
const read=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('office_taste_profile_v1')));

test('L2: dwie ankiety aktualizują widok bez reloadu i nie tracą oceny drugiej osoby',()=>pair(async(a,b)=>{
 await a.locator('[data-person="Bartek"]').click();await a.locator('.choices[data-id="rock"] .choice[data-val="like"]').click();
 await b.locator('[data-person="Bartek"]').click();await b.waitForFunction(()=>document.querySelector('.choices[data-id="rock"] .choice[data-val="like"]').dataset.active==='like');
 await b.locator('#changePerson').click();await b.locator('[data-person="Edyta"]').click();await b.locator('.choices[data-id="pop"] .choice[data-val="ok"]').click();
 await b.waitForFunction(()=>JSON.parse(localStorage.getItem('office_taste_profile_v1')).people.Edyta.genres.pop==='ok');
 assert.equal((await read(a)).people.Bartek.genres.rock,'like');
}));
test('L2: ankieta odświeża liczniki generatora i zachowuje zaznaczoną obecność',()=>pair(async(a,b)=>{
 await a.locator('[data-presence-id="monika"]').click();await b.locator('[data-person="Bartek"]').click();await b.locator('.choices[data-id="rock"] .choice[data-val="like"]').click();
 await a.waitForFunction(()=>document.querySelector('[data-presence-id="bartek"] .presence-meta').textContent.includes('❤️1'));
 assert.equal(await a.locator('[data-presence-id="monika"]').getAttribute('aria-pressed'),'false');
},'/','/taste.html'));
test('L2: równoległe różne gatunki ze wspólnej starej bazy scalają się pod Web Lock',()=>pair(async(a,b)=>{
 const initial=JSON.stringify(db());await a.evaluate(raw=>localStorage.setItem('office_taste_profile_v1',raw),initial);
 const nextA=db(),nextB=db();nextA.people.Bartek.genres.pop='ok';nextB.people.Edyta.genres.jazz='like';
 const writes=await Promise.all([a.evaluate(async({base,next})=>OmmLocalState.edit('office_taste_profile_v1',base,next,{json:true}),{base:initial,next:JSON.stringify(nextA)}),b.evaluate(async({base,next})=>OmmLocalState.edit('office_taste_profile_v1',base,next,{json:true}),{base:initial,next:JSON.stringify(nextB)})]);
 assert.ok(writes.some(raw=>{const x=JSON.parse(raw);return x.people.Bartek.genres.pop==='ok'&&x.people.Edyta.genres.jazz==='like';}));
 await a.waitForFunction(()=>JSON.parse(localStorage.getItem('office_taste_profile_v1')).people.Edyta.genres.jazz==='like');
 const final=await read(a);assert.equal(final.people.Bartek.genres.pop,'ok');assert.equal(final.people.Edyta.genres.jazz,'like');assert.equal(final.people.Bartek.genres.rock,'like');
}));
test('L2: ta sama ocena — jawny konflikt, brak automatycznego nadpisania',()=>pair(async(a,b)=>{
 const initial=JSON.stringify(db());await a.evaluate(raw=>localStorage.setItem('office_taste_profile_v1',raw),initial);
 const nextA=db(),nextB=db();nextA.people.Bartek.genres.rock='no';nextB.people.Bartek.genres.rock='ok';
 await a.evaluate(({base,next})=>OmmLocalState.edit('office_taste_profile_v1',base,next,{json:true}),{base:initial,next:JSON.stringify(nextA)});
 const result=await b.evaluate(async({base,next})=>{try{await OmmLocalState.edit('office_taste_profile_v1',base,next,{json:true});return 'unsafe';}catch(e){return e.name;}},{base:initial,next:JSON.stringify(nextB)});
 assert.equal(result,'LocalStateConflict');assert.equal((await read(a)).people.Bartek.genres.rock,'no');assert.match(await b.locator('#localStateNotice').textContent(),/innej karcie/);
}));
test('L2: usunięcie gatunku nie usuwa niezależnej oceny; usunięcie całego magazynu jest konfliktem',()=>pair(async(a,b)=>{
 const initial=JSON.stringify(db());await a.evaluate(raw=>localStorage.setItem('office_taste_profile_v1',raw),initial);const removed=db();delete removed.people.Bartek.genres.rock;
 const added=db();added.people.Edyta.genres.pop='like';await a.evaluate(({base,next})=>OmmLocalState.edit('office_taste_profile_v1',base,next,{json:true}),{base:initial,next:JSON.stringify(added)});
 await b.evaluate(({base,next})=>OmmLocalState.edit('office_taste_profile_v1',base,next,{json:true}),{base:initial,next:JSON.stringify(removed)});
 await a.waitForFunction(()=>JSON.parse(localStorage.getItem('office_taste_profile_v1')).people.Bartek.genres.rock===undefined);
 assert.equal((await read(a)).people.Bartek.genres.rock,undefined);assert.equal((await read(a)).people.Edyta.genres.pop,'like');
 await a.evaluate(()=>localStorage.removeItem('office_taste_profile_v1'));
 assert.equal(await b.evaluate(async({base,next})=>{try{await OmmLocalState.edit('office_taste_profile_v1',base,next,{json:true});return false;}catch(e){return e.name==='LocalStateConflict';}},{base:initial,next:JSON.stringify(added)}),true);
}));
test('L2: wyczyszczenie osoby nie usuwa ocen dodanych po otwarciu starej kopii',()=>pair(async(a,b)=>{
 const initial=JSON.stringify(db());await a.evaluate(raw=>localStorage.setItem('office_taste_profile_v1',raw),initial);const added=db();added.people.Bartek.genres.pop='like';const cleared=db();cleared.people.Bartek.genres={};
 await a.evaluate(raw=>localStorage.setItem('office_taste_profile_v1',raw),JSON.stringify(added));
 const result=await b.evaluate(async({base,next})=>{try{await OmmLocalState.edit('office_taste_profile_v1',base,next,{json:true,strictPerson:'Bartek'});return false;}catch(e){return e.name==='LocalStateConflict';}},{base:initial,next:JSON.stringify(cleared)});
 assert.equal(result,true);assert.equal((await read(a)).people.Bartek.genres.pop,'like');
}));
test('L2: niezapisany draft wzorców pozostaje widoczny; starszy klient wywołuje konflikt przy zapisie',()=>pair(async(a,b)=>{
 await b.evaluate(()=>localStorage.setItem('office_seed_bartek','old'));
 await a.locator('[data-person="Bartek"]').click();
 await a.waitForFunction(()=>document.querySelector('[data-seed-profile-id="bartek"]').value==='old');
 const input=a.locator('[data-seed-profile-id="bartek"]');await input.fill('draft');
 await b.evaluate(()=>localStorage.setItem('office_seed_bartek','other'));
 await a.waitForTimeout(100);assert.equal(await input.inputValue(),'draft');
 await a.locator('#saveSeedArtists').click();await a.waitForFunction(()=>document.querySelector('#localStateNotice')?.textContent.includes('innej karcie'));
 assert.equal(await a.evaluate(()=>localStorage.getItem('office_seed_bartek')),'other');assert.equal(await input.inputValue(),'draft');
},'/taste.html','/'));
test('L2: marker importu blokuje zapisy także w drugiej karcie; widok odświeża się po zakończeniu',()=>pair(async(a,b)=>{
 await a.evaluate(()=>{localStorage.setItem('omm_local_import_pending','1');localStorage.setItem('office_seed_bartek','imported');});
 const rejected=await b.evaluate(async()=>{try{await OmmLocalState.edit('office_seed_bartek',null,'unsafe');return false;}catch{return true;}});assert.equal(rejected,true);
 await a.evaluate(()=>localStorage.removeItem('omm_local_import_pending'));
 await b.locator('[data-person="Bartek"]').click();
 await b.waitForFunction(()=>document.querySelector('[data-seed-profile-id="bartek"]').value==='imported');
},'/','/taste.html'));
test('L2: 12 kolejnych równoległych zapisów nie gubi niezależnych zmian',()=>pair(async(a,b)=>{
 for(let iteration=0;iteration<12;iteration++){
  const initial=JSON.stringify(db());await a.evaluate(raw=>localStorage.setItem('office_taste_profile_v1',raw),initial);
  await b.waitForFunction(raw=>localStorage.getItem('office_taste_profile_v1')===raw,initial);
  const first=db(),second=db();first.people.Bartek.genres.pop='ok';second.people.Edyta.genres.jazz='like';
  const writes=await Promise.all([a.evaluate(({base,next})=>OmmLocalState.edit('office_taste_profile_v1',base,next,{json:true}),{base:initial,next:JSON.stringify(first)}),b.evaluate(({base,next})=>OmmLocalState.edit('office_taste_profile_v1',base,next,{json:true}),{base:initial,next:JSON.stringify(second)})]);
  assert.ok(writes.some(raw=>{const x=JSON.parse(raw);return x.people.Bartek.genres.pop==='ok'&&x.people.Edyta.genres.jazz==='like';}),`iteration ${iteration}`);
  for(const page of [a,b])await page.waitForFunction(()=>{const x=JSON.parse(localStorage.getItem('office_taste_profile_v1'));return x.people.Bartek.genres.pop==='ok'&&x.people.Edyta.genres.jazz==='like';});
 }
}));
test('L2: brak Web Locks nie zapisuje niechronionej edycji',()=>pair(async(a)=>{
 const result=await a.evaluate(async()=>{
  const before=localStorage.getItem('office_seed_bartek');Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});
  try{await OmmLocalState.edit('office_seed_bartek',before,'new');return false;}catch{return localStorage.getItem('office_seed_bartek')===before && OmmLocalState.pendingWrites===0;}
 });assert.equal(result,true);
}));
test('L2: quota podczas scalonego zapisu zachowuje obie wcześniejsze oceny',()=>pair(async(a,b)=>{
 const initial=JSON.stringify(db());await a.evaluate(raw=>localStorage.setItem('office_taste_profile_v1',raw),initial);const next=db();next.people.Edyta.genres.pop='like';
 await a.evaluate(raw=>localStorage.setItem('office_taste_profile_v1',raw),JSON.stringify(next));await b.waitForFunction(raw=>localStorage.getItem('office_taste_profile_v1')===raw,JSON.stringify(next));
 const draft=db();draft.people.Bartek.genres.jazz='ok';
 const result=await b.evaluate(async({base,next})=>{
  const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='office_taste_profile_v1')throw new DOMException('full','QuotaExceededError');return original.call(this,key,value);};
  try{await OmmLocalState.edit('office_taste_profile_v1',base,next,{json:true});return false;}catch{return OmmLocalState.pendingWrites===0;}finally{Storage.prototype.setItem=original;}
 },{base:initial,next:JSON.stringify(draft)});
 assert.equal(result,true);const final=await read(b);assert.equal(final.people.Edyta.genres.pop,'like');assert.equal(final.people.Bartek.genres.rock,'like');assert.equal(final.people.Bartek.genres.jazz,undefined);
}));
test('L2: brak zapisu metadanych nie zmienia preferencji i zeruje pendingWrites',()=>pair(async(a)=>{
 const result=await a.evaluate(async()=>{
  const before=localStorage.getItem('office_seed_bartek');const original=indexedDB.open;indexedDB.open=()=>{throw new Error('unavailable');};
  try{await OmmLocalState.edit('office_seed_bartek',before,'new');return false;}catch{return localStorage.getItem('office_seed_bartek')===before && OmmLocalState.pendingWrites===0;}finally{indexedDB.open=original;}
 });assert.equal(result,true);
}));
test('L2: nawigacja jest ostrzegana podczas oczekiwania na zapis, po zakończeniu już nie',()=>pair(async(a)=>{
 const result=await a.evaluate(async()=>{
  let release, entered;const ready=new Promise(resolve=>{entered=resolve;});
  const hold=navigator.locks.request('omm-local-import',()=>new Promise(resolve=>{release=resolve;entered();}));await ready;
  const pending=OmmLocalState.edit('office_seed_bartek',localStorage.getItem('office_seed_bartek'),'new');
  const during=new Event('beforeunload',{cancelable:true});window.dispatchEvent(during);release();await hold;await pending;
  const after=new Event('beforeunload',{cancelable:true});window.dispatchEvent(after);
  return [during.defaultPrevented,after.defaultPrevented];
 });assert.deepEqual(result,[true,false]);
}));
