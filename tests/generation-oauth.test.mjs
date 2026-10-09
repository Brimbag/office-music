import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserHarness } from './helpers/browser.mjs';
let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(fn, arg) {
  const session = await harness.page();
  try { const result = await session.page.evaluate(fn, arg); assert.deepEqual(session.errors, []); return result; }
  finally { await session.close(); }
}
for (const scenario of ['401', '429-expiry', 'network', 'invalid-grant', 'second-401', 'valid']) {
  test(`OAuth Search: ${scenario}, zachowane budżety i najwyżej jedno wznowienie 401`, async () => {
    const r = await evaluate(async scenario => {
      localStorage.setItem('spotify_access_token', 'old'); localStorage.setItem('spotify_refresh_token', 'refresh-old');
      localStorage.setItem('spotify_token_expires', String(Date.now() + 3600000));
      let requests = 0, refreshes = 0, waits = 0; const headers = [];
      waitForSearchSlot = async () => {};
      sleep = async () => { waits++; localStorage.setItem('spotify_token_expires', '0'); };
      window.fetch = async (url, options) => {
        if (String(url).includes('/api/token')) {
          refreshes++;
          if (scenario === 'network') throw new TypeError('Network unavailable');
          if (scenario === 'invalid-grant') return Response.json({ error: 'invalid_grant' }, { status: 400 });
          return Response.json({ access_token: 'new', refresh_token: 'refresh-new', expires_in: 3600 });
        }
        requests++; headers.push(options.headers.Authorization);
        if (scenario === '429-expiry' && requests === 1) return Response.json({ error: {} }, { status: 429, headers: { 'Retry-After': '1' } });
        if (scenario !== 'valid' && scenario !== '429-expiry' && (requests === 1 || scenario === 'second-401')) return Response.json({ error: { status: 401 } }, { status: 401 });
        return Response.json({ tracks: { items: [] } });
      };
      newSearchesThisGeneration = 0; maxNewSearchesThisGeneration = 12;
      let error = ''; try { await searchTracks('old', 'genre:"rock"'); } catch (e) { error = e.message; }
      return { requests, refreshes, waits, headers, error, searches: newSearchesThisGeneration,
        access: localStorage.getItem('spotify_access_token'), refresh: localStorage.getItem('spotify_refresh_token') };
    }, scenario);
    assert.equal(r.searches, 1); assert.equal(r.refreshes, scenario === 'valid' ? 0 : 1);
    if (['network', 'invalid-grant', 'second-401'].includes(scenario)) assert.ok(r.error);
    else assert.equal(r.error, '');
    if (scenario === 'network') { assert.equal(r.access, 'old'); assert.equal(r.refresh, 'refresh-old'); assert.match(r.error, /Sesja zachowana/); assert.equal(r.requests, 1); }
    if (scenario === 'invalid-grant') { assert.equal(r.access, null); assert.equal(r.refresh, null); assert.match(r.error, /Zaloguj/); }
    if (scenario === 'second-401') assert.equal(r.requests, 2);
    if (scenario === '401' || scenario === '429-expiry') assert.deepEqual(r.headers, ['Bearer old', 'Bearer new']);
    if (scenario === '429-expiry') assert.equal(r.waits, 1);
  });
}
for (const operation of ['create', 'add']) test(`jawne 401 przed ${operation}: wznowione tylko odrzucone żądanie, bez duplikatów`, async () => {
  const r = await evaluate(async operation => {
    localStorage.setItem('spotify_access_token', 'old'); localStorage.setItem('spotify_refresh_token', 'r'); localStorage.setItem('spotify_token_expires', String(Date.now() + 3600000));
    let requests = 0, refreshes = 0; const accepted = [], headers = [];
    window.fetch = async (url, options) => {
      if (String(url).includes('/api/token')) { refreshes++; return Response.json({ access_token: 'new', expires_in: 3600 }); }
      requests++; headers.push(options.headers.Authorization);
      if (requests === 1) return Response.json({ error: { status: 401 } }, { status: 401 });
      accepted.push(JSON.parse(options.body));
      return Response.json(operation === 'create' ? { id: 'one', uri: 'spotify:playlist:one' } : { snapshot_id: 'one' });
    };
    if (operation === 'create') await createPlaylist('old', [{ name: 'Test' }], 120);
    else await addItemsToPlaylist('old', 'one', Array.from({ length: 120 }, (_, i) => `spotify:track:t${i}`));
    return { requests, refreshes, accepted, headers };
  }, operation);
  assert.equal(r.refreshes, 1); assert.equal(r.requests, operation === 'create' ? 2 : 3);
  assert.equal(r.accepted.length, operation === 'create' ? 1 : 2);
  assert.ok(r.headers.slice(1).every(h => h === 'Bearer new'));
  if (operation === 'add') { assert.equal(r.accepted.flatMap(body => body.uris).length, 120); assert.equal(new Set(r.accepted.flatMap(body => body.uris)).size, 120); }
});
for (const operation of ['create', 'add']) test(`niejednoznaczny błąd sieci po ${operation}: bez ponowienia zapisu`, async () => {
  const r = await evaluate(async operation => {
    let requests = 0; window.fetch = async () => { requests++; throw new TypeError('Connection lost after possible commit'); };
    let error; try { if (operation === 'create') await createPlaylist('mock', [{ name: 'Test' }], 1); else await addItemsToPlaylist('mock', 'existing', ['spotify:track:t']); } catch (e) { error = e.message; }
    return { requests, error };
  }, operation);
  assert.equal(r.requests, 1); assert.ok(r.error);
});
test('dwa równoległe 401 dzielą odświeżenie oraz rotację refresh tokenu', async () => {
  const r = await evaluate(async () => {
    localStorage.setItem('spotify_access_token', 'old'); localStorage.setItem('spotify_refresh_token', 'r'); localStorage.setItem('spotify_token_expires', String(Date.now() + 3600000));
    let refreshes = 0, successful = 0;
    window.fetch = async (url, options) => {
      if (String(url).includes('/api/token')) { refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); return Response.json({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }); }
      if (options.headers.Authorization === 'Bearer old') return Response.json({}, { status: 401 });
      successful++; return Response.json({ ok: true });
    };
    await Promise.all([spotifyGenerationRequest('old', 'https://api.spotify.com/v1/me'), spotifyGenerationRequest('old', 'https://api.spotify.com/v1/me/playlists')]);
    return { refreshes, successful, refresh: localStorage.getItem('spotify_refresh_token') };
  });
  assert.deepEqual(r, { refreshes: 1, successful: 2, refresh: 'rotated' });
});
test('wylogowanie podczas odświeżania nie jest cofane przez spóźnioną odpowiedź; przejściowe 503 nie kasuje sesji', async () => {
  const r = await evaluate(async () => {
    const seed = () => { localStorage.setItem('spotify_access_token', 'old'); localStorage.setItem('spotify_refresh_token', 'r'); localStorage.setItem('spotify_token_expires', '0'); }; seed();
    window.fetch = async () => { clearTokens(); return Response.json({ access_token: 'late', refresh_token: 'late-r', expires_in: 3600 }); };
    try { await refreshAccessToken(); } catch {}
    const loggedOut = localStorage.getItem('spotify_access_token'); seed();
    window.fetch = async () => Response.json({ error: 'server_error' }, { status: 503 });
    let error; try { await refreshAccessToken(); } catch (e) { error = e.message; }
    return { loggedOut, access: localStorage.getItem('spotify_access_token'), refresh: localStorage.getItem('spotify_refresh_token'), error };
  });
  assert.equal(r.loggedOut, null); assert.equal(r.access, 'old'); assert.equal(r.refresh, 'r'); assert.match(r.error, /503/);
});
for (const operation of ['create', 'add']) test(`wygaśnięcie przed ${operation}: odświeżenie przed zapisem, jedno żądanie zapisu`, async () => {
  const r = await evaluate(async operation => {
    localStorage.setItem('spotify_access_token','old'); localStorage.setItem('spotify_refresh_token','r'); localStorage.setItem('spotify_token_expires','0');
    let writes=0, refreshes=0; const headers=[];
    window.fetch=async (url,options) => {
      if(String(url).includes('/api/token')) { refreshes++; return Response.json({access_token:'new',expires_in:3600}); }
      writes++; headers.push(options.headers.Authorization); return Response.json({id:'one',snapshot_id:'one'});
    };
    if(operation==='create') await createPlaylist('old',[{name:'Test'}],1); else await addItemsToPlaylist('old','one',['spotify:track:one']);
    return {writes,refreshes,headers};
  },operation);
  assert.deepEqual(r,{writes:1,refreshes:1,headers:['Bearer new']});
});
test('Web Locks chroni rotację refresh tokenu również między dwiema kartami', async () => {
  const session=await harness.page(); const other=await session.page.context().newPage();
  const events=[]; await session.page.context().exposeBinding('recordRefresh', ({page}, state) => events.push({tab:page===session.page?1:2,state,at:Date.now()}));
  try {
    await other.goto(session.page.url());
    const setup=() => { window.testTrace=[]; window.fetch=async url => { if (!String(url).includes('/api/token')) return Response.json({ id: 'mock', state: {} }); await window.recordRefresh('start'); window.testTrace.push({ old:localStorage.getItem('spotify_access_token')==='old', valid:Number(localStorage.getItem('spotify_token_expires'))>Date.now(), locks:!!navigator.locks, held: navigator.locks ? (await navigator.locks.query()).held.length : 0 }); localStorage.setItem('test_refresh_count',String(Number(localStorage.getItem('test_refresh_count')||0)+1)); await new Promise(resolve=>setTimeout(resolve,30)); await window.recordRefresh('end'); return Response.json({access_token:'fresh',refresh_token:'rotated',expires_in:3600}); }; };
    await session.page.evaluate(setup); await other.evaluate(setup);
    await session.page.evaluate(() => {localStorage.setItem('spotify_access_token','old');localStorage.setItem('spotify_refresh_token','old-r');localStorage.setItem('spotify_token_expires','0');});
    // Both tabs must start with the same expired session before racing refresh.
    await other.waitForFunction(() => localStorage.getItem('spotify_access_token') === 'old' && localStorage.getItem('spotify_refresh_token') === 'old-r' && localStorage.getItem('spotify_token_expires') === '0');
    const values=await Promise.all([session.page.evaluate(()=>refreshAccessToken('old')),other.evaluate(()=>refreshAccessToken('old'))]);
    assert.deepEqual(values,['fresh','fresh']);
    const trace=await Promise.all([session.page.evaluate(()=>window.testTrace),other.evaluate(()=>window.testTrace)]);
    assert.equal(await session.page.evaluate(()=>Number(localStorage.getItem('test_refresh_count'))),1,JSON.stringify({trace,events}));
    assert.deepEqual(session.errors,[]);
  } finally { await session.close(); }
});
test('niedostępna synchronizacja OAuth: sesja zachowana, brak ryzykownej rotacji', async () => {
  const result = await evaluate(async () => {
    localStorage.setItem('spotify_access_token','old'); localStorage.setItem('spotify_refresh_token','old-r'); localStorage.setItem('spotify_token_expires','0');
    spotifyOAuthRotation = async () => { throw new Error('OAuth storage unavailable; session retained'); };
    let requests=0; window.fetch=async()=>{requests++;return Response.json({});};
    let error=''; try { await refreshAccessToken('old'); } catch(e) { error=e.message; }
    return {requests,error,refresh:localStorage.getItem('spotify_refresh_token')};
  });
  assert.equal(result.requests,0); assert.equal(result.refresh,'old-r'); assert.ok(result.error);
});
test('wylogowanie usuwa także rekord przekazania rotacji OAuth', async () => {
  const result = await evaluate(async () => {
    await spotifyOAuthRotation({previousRefresh:'old-r',refresh:'rotated',access:'fresh',expires:Date.now()+3600000});
    localStorage.setItem('spotify_refresh_token','rotated'); clearTokens();
    await navigator.locks.request('omm-spotify-refresh',()=>{});
    return {rotation:await spotifyOAuthRotation() ?? null,refresh:localStorage.getItem('spotify_refresh_token')};
  });
  assert.deepEqual(result,{rotation:null,refresh:null});
});
test('rekord innej sesji nie przypisuje poprzedniego tokenu do nowego logowania', async () => {
  const result = await evaluate(async () => {
    await spotifyOAuthRotation({previousRefresh:'unrelated',refresh:'another',access:'other',expires:Date.now()+3600000});
    localStorage.setItem('spotify_access_token','old'); localStorage.setItem('spotify_refresh_token','old-r'); localStorage.setItem('spotify_token_expires','0');
    let requests=0; window.fetch=async()=>{requests++;return Response.json({access_token:'fresh',refresh_token:'rotated',expires_in:3600});};
    return {access:await refreshAccessToken('old'),requests,refresh:localStorage.getItem('spotify_refresh_token')};
  });
  assert.deepEqual(result,{access:'fresh',requests:1,refresh:'rotated'});
});
test('nowe logowanie podczas odczytu przekazania OAuth ma pierwszeństwo', async () => {
  const result = await evaluate(async () => {
    localStorage.setItem('spotify_access_token','old'); localStorage.setItem('spotify_refresh_token','old-r'); localStorage.setItem('spotify_token_expires','0');
    spotifyOAuthRotation=async()=>{
      localStorage.setItem('spotify_access_token','login'); localStorage.setItem('spotify_refresh_token','login-r'); localStorage.setItem('spotify_token_expires',String(Date.now()+3600000));
      return {previousRefresh:'old-r',access:'fresh',refresh:'rotated',expires:Date.now()+3600000};
    };
    let requests=0; window.fetch=async()=>{requests++;return Response.json({});};
    return {access:await refreshAccessToken('old'),requests,refresh:localStorage.getItem('spotify_refresh_token')};
  });
  assert.deepEqual(result,{access:'login',requests:0,refresh:'login-r'});
});
