import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness.close(); });

test('presence supports keyboard selection without changing stored preferences', async () => {
  const initial = {office_seed_asia: 'Enya', office_genres_asia: 'pop', office_blocked_asia: 'Example'};
  const {page, errors, close} = await harness.page('/', initial);
  try {
    await page.evaluate(() => { mixerBox.style.display='block'; renderProfiles(); });
    assert.match(await page.locator('#presenceSummary').textContent(), /Obecni \(4\)/);
    const asia = page.locator('[data-presence-id="asia"]');
    await asia.focus(); await page.keyboard.press('Space');
    assert.match(await page.locator('#presenceSummary').textContent(), /Obecni \(3\): Bartek, Edyta, Monika/);
    assert.equal(await page.locator('[data-profile-id="bartek"]').isDisabled(), true);
    assert.equal(await page.locator('#manualPreferences details[open]').count(), 0);
    assert.equal(await asia.getAttribute('aria-pressed'), 'false');
    await page.keyboard.press('Enter');
    assert.equal(await asia.getAttribute('aria-pressed'), 'true');
    await asia.click();
    assert.equal(await asia.getAttribute('aria-pressed'), 'false');
    await asia.click();
    assert.equal(await page.locator('[data-presence-id="bartek"]').isDisabled(), true);
    await page.locator('#manualPreferencesPanel > summary').click();
    await page.locator('[data-preferences-id="asia"] > summary').click();
    assert.equal(await page.locator('[data-seed-profile-id="asia"]').count(), 0);
    assert.equal(await page.locator('[data-preferences-id="asia"] a').getAttribute('href'), 'taste.html#asia');
    assert.equal(await page.evaluate(()=>localStorage.getItem('office_seed_asia')), 'Enya');
    assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(k => [k,localStorage.getItem(k)])), Object.keys(initial)),initial);
    for (const id of ['generateButton','syncLastFmButton','exportStateButton','importStateButton','cloudUploadButton','cloudDownloadButton','clearHistoryButton']) assert.equal(await page.locator(`#${id}`).count(),1);
    await page.locator('#generatorTools > summary').click();
    assert.equal(await page.locator('#exportStateButton').isVisible(),true);
    for (const width of [360,768,1280]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    }
    assert.deepEqual(errors,[]);
  } finally { await close(); }
});

test('short result preserves diagnostics, track actions and underlying data', async () => {
  const {page,errors,close} = await harness.page();
  try {
    const result = await page.evaluate(() => {
      tasteGenreDiagnosticText=()=>''; seedArtistDiagnosticText=()=>'';
      const tracks = [{id:'test',uri:'spotify:track:test',name:'Test song',artists:[{id:'artist',name:'Test artist'}]}];
      const selected=[{id:'bartek',name:'Bartek'},{id:'asia',name:'Asia'}];
      const group={satisfaction:{bartek:{average:70,strong:1,weak:0},asia:{average:72,strong:1,weak:0}},discoveryCount:0,discoveryQuota:{target:.3,min:1,max:0},requestedDiscoveryQuota:{max:21},discoveryRepair:{beforeDiscovery:1,beforeLength:2,afterDiscovery:0,afterLength:1,added:0,removed:1,minimumShortfall:1},rejectionStats:{rawPool:2000,eligible:55}};
      const before=JSON.stringify({tracks,selected,group});
      renderPlaylistResult({id:'playlist'},tracks,selected,[],60,null,group,null,new Map([[tracks[0],'saved diagnostic']]));
      return {before,after:JSON.stringify({tracks,selected,group})};
    });
    assert.equal(result.before,result.after);
    assert.match(await page.locator('.result-heading').textContent(),/1 z 60/);
    assert.equal(await page.locator('.fit-card').count(),2);
    assert.match(await page.locator('.fit-cards').textContent(),/Asia: 72\/100/);
    assert.equal(await page.locator('#playlistDiagnostics').getAttribute('open'),null);
    assert.equal(await page.locator('.result-list > li').count(),1);
    await page.locator('#playlistDiagnostics > summary').click();
    assert.match(await page.locator('#playlistDiagnostics').textContent(),/Diagnostyka filtrów: pula 2000 → kwalifikowalne 55/);
    assert.match(await page.locator('#playlistResult .result-list > li .track-meta').first().textContent(),/saved diagnostic/);
    assert.deepEqual(errors,[]);
  } finally { await close(); }
});
