import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserHarness} from './helpers/browser.mjs';
let h;before(async()=>h=await startBrowserHarness());after(async()=>h.close());
async function run(fn,path='/taste.html',storage={}){const s=await h.page(path,storage);try{await fn(s.page);assert.deepEqual(s.errors,[]);}finally{await s.close();}}
async function save(page,kind,value){const input=kind==='seed'?'seedArtists':'blockedArtists',button=kind==='seed'?'saveSeedArtists':'saveBlockedArtists';await page.locator('#'+input).fill(value);await page.locator('#'+button).click();await page.waitForFunction(id=>!document.getElementById(id).disabled,button);}
test('U3 legacy values survive opening every person; only their existing keys are edited',()=>run(async p=>{
 const before=await p.evaluate(()=>OmmLocalState.snapshot());
 for(const person of ['Bartek','Edyta','Asia','Monika']){
  await p.locator(`[data-person="${person}"]`).click();assert.equal(await p.locator('#seedArtists').inputValue(),`${person} Seed`);assert.equal(await p.locator('#blockedArtists').inputValue(),`${person} Block`);await p.locator('#changePerson').click();
 }
 assert.deepEqual(await p.evaluate(()=>OmmLocalState.snapshot()),before);
 await p.locator('[data-person="Asia"]').click();await save(p,'seed','  New Artist, Second  ');await save(p,'blocked','Other');
 const after=await p.evaluate(()=>OmmLocalState.snapshot());assert.equal(after.office_seed_asia,'New Artist, Second');assert.equal(after.office_blocked_asia,'Other');
 for(const key of Object.keys(before).filter(k=>!['office_seed_asia','office_blocked_asia'].includes(k)))assert.equal(after[key],before[key]);
},'/taste.html',Object.fromEntries(['Bartek','Edyta','Asia','Monika'].flatMap(p=>[[`office_seed_${p.toLowerCase()}`,`${p} Seed`],[`office_blocked_${p.toLowerCase()}`,`${p} Block`]]))));
test('U3 Edyta default and explicit empty block have different semantics',()=>run(async p=>{
 await p.locator('[data-person="Edyta"]').click();assert.equal(await p.locator('#blockedArtists').inputValue(),'Slipknot');assert.equal(await p.evaluate(()=>localStorage.getItem('office_blocked_edyta')),null);
 await save(p,'blocked','');await p.reload();await p.locator('[data-person="Edyta"]').click();assert.equal(await p.locator('#blockedArtists').inputValue(),'');assert.equal(await p.evaluate(()=>localStorage.getItem('office_blocked_edyta')),'');
}));
test('U3 drafts stay with their person when switching; genre clear preserves artists',()=>run(async p=>{
 await p.locator('[data-person="Bartek"]').click();await p.locator('#seedArtists').fill('draft');await p.locator('#changePerson').click();await p.locator('[data-person="Asia"]').click();assert.equal(await p.locator('#seedArtists').inputValue(),'');await save(p,'seed','Asia Seed');await p.locator('#changePerson').click();await p.locator('[data-person="Bartek"]').click();assert.equal(await p.locator('#seedArtists').inputValue(),'draft');await save(p,'seed','Bartek Seed');
 const dialog=p.waitForEvent('dialog');const clicking=p.locator('#clearPerson').click();await (await dialog).accept();await clicking;await p.waitForFunction(()=>!document.getElementById('clearPerson').disabled);assert.equal(await p.evaluate(()=>localStorage.getItem('office_seed_bartek')),'Bartek Seed');assert.equal(await p.evaluate(()=>localStorage.getItem('office_seed_asia')),'Asia Seed');
}));
test('U3 quota failure retains saved list and draft',()=>run(async p=>{
 await p.locator('[data-person="Bartek"]').click();await p.evaluate(()=>{window.originalArtistSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='office_seed_bartek')throw new DOMException('full','QuotaExceededError');return originalArtistSet.call(this,key,value);};});
 await save(p,'seed','draft');assert.equal(await p.locator('#seedArtists').inputValue(),'draft');assert.equal(await p.evaluate(()=>localStorage.getItem('office_seed_bartek')),'old');assert.match(await p.locator('#artistSaveState').textContent(),/Nie zapisano/);await p.evaluate(()=>Storage.prototype.setItem=originalArtistSet);
},'/taste.html',{office_seed_bartek:'old'}));
test('U3 generator link opens the right person; inputs have accessible labels and fit mobile',()=>run(async p=>{
 assert.equal(await p.locator('#activePerson').textContent(),'Asia');assert.equal(await p.getByLabel('Artyści wzorcowi',{exact:true}).count(),1);
 for(const width of [360,768,1280]){await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
},'/taste.html#asia'));
test('U3 cross-tab survey save immediately reaches generator without replacing presence or normalizing stored lists',()=>run(async p=>{
 await p.evaluate(()=>{mixerBox.style.display='block';renderProfiles();document.querySelector('[data-presence-id="asia"]').click();});
 const other=await p.context().newPage();await other.goto(new URL('taste.html#bartek',p.url()).href);await other.waitForFunction(()=>window.ommStorageReady);
 await save(other,'seed','New, Second');await save(other,'blocked','Wrong');
 await p.waitForFunction(()=>localStorage.getItem('office_seed_bartek')==='New, Second');const profiles=await p.evaluate(()=>selectedProfiles());assert.deepEqual(profiles.find(p=>p.id==='bartek').artists,['New','Second']);assert.deepEqual(profiles.find(p=>p.id==='bartek').blockedArtists,['Wrong']);assert.ok(!profiles.some(p=>p.id==='asia'));assert.equal(await p.locator('[data-seed-profile-id]').count(),0);
 await other.close();
},'/'));
test('U3 unsaved artist drafts warn before leaving; saving clears the warning',()=>run(async p=>{
 await p.locator('[data-person="Bartek"]').click();const blocked=()=>p.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented;});assert.equal(await blocked(),false);await p.locator('#seedArtists').fill('draft');assert.equal(await blocked(),true);await save(p,'seed','Saved');assert.equal(await blocked(),false);
}));
test('U3 two surveys independently edit seed and blocked lists without losing either save',()=>run(async p=>{
 await p.locator('[data-person="Bartek"]').click();const other=await p.context().newPage();await other.goto(new URL('taste.html#bartek',p.url()).href);await other.waitForFunction(()=>window.ommStorageReady);
 await Promise.all([save(p,'seed','Queen'),save(other,'blocked','Blocked')]);
 for(const page of [p,other]){await page.waitForFunction(()=>localStorage.getItem('office_seed_bartek')==='Queen'&&localStorage.getItem('office_blocked_bartek')==='Blocked');await page.waitForFunction(()=>document.getElementById('seedArtists').value==='Queen'&&document.getElementById('blockedArtists').value==='Blocked');}
 await other.close();
}));
