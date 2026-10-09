// Read-only production audit: runs the real pipeline against local synthetic state
// and a closed mock transport. No application code or live services are changed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installP4Variant } from '../helpers/p4-variants.mjs';
import { installP4Fixture } from '../helpers/p4-fixture.mjs';
import { startBrowserHarness } from '../helpers/browser.mjs';

const freshResults = process.env.OMM_BENCH_FRESH_RESULTS === '1';
const peopleCases = process.env.OMM_BENCH_PEOPLE ? [Number(process.env.OMM_BENCH_PEOPLE)] : [2,4];
assert.ok(peopleCases.every(value=>[2,4].includes(value)));
const cacheCases = process.env.OMM_BENCH_CACHE ? [process.env.OMM_BENCH_CACHE] : ['cold','warm'];
assert.ok(cacheCases.every(value=>['cold','warm'].includes(value)));
const variants = process.env.OMM_BENCH_VARIANTS === '1';
const variantSource = variants ? installP4Variant.toString() : null;
const fixtureSource = (variants || process.env.OMM_BENCH_REALISTIC === '1') ? installP4Fixture.toString() : null;
const repetitions = Number(process.env.OMM_BENCH_REPETITIONS || 5);
const transportDelayMs = Number(process.env.OMM_BENCH_API_DELAY_MS || 0);
const instrument = process.env.OMM_BENCH_INSTRUMENT !== '0';
const fixedClock = process.env.OMM_BENCH_FIXED_CLOCK === '1';
const edges = process.env.OMM_BENCH_EDGES === '1';
const matrix = process.env.OMM_BENCH_MATRIX === '1';
const baseline = process.env.OMM_BENCH_BASELINE ? JSON.parse(readFileSync(process.env.OMM_BENCH_BASELINE, 'utf8')) : null;
assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 20);
assert.ok(Number.isFinite(transportDelayMs) && transportDelayMs >= 0 && transportDelayMs <= 1000);
const harness = await startBrowserHarness();
const results = [], datasetDigests = new Map();
try {
  for (const people of peopleCases) for (const cache of edges ? ['cold'] : cacheCases) for (const target of matrix ? [30, 60, 120] : [60]) for (const poolSize of matrix ? [80, 2000] : [2000]) for (const variant of variants ? ['A','B','C'] : ['A']) for (const caseKind of edges ? ['no-results', 'blocked', 'expired-cache', 'changed-profiles', '429', 'network'] : ['normal']) {
    const samples = [];
    for (let iteration = 0; iteration <= repetitions; iteration++) {
      const session = await harness.page();
      try {
        const output = await session.page.evaluate(async ({ people, cache, transportDelayMs, instrument, fixedClock, baseline, target, poolSize, caseKind, fixtureSource, variant, variantSource, variants, freshResults }) => {
          if (baseline?.progressSource) (0,eval)(baseline.progressSource);
          if (baseline) for (const [name, source] of Object.entries(baseline.functions)) window[name] = (0, eval)(`(${source})`);
          if (fixedClock) {
            const wallNow = Date.now;
            const modelNow = Date.parse('2026-10-09T09:00:00Z');
            Date.now = () => modelNow;
            let randomState = 123456789;
            crypto.getRandomValues = array => {
              for (let i = 0; i < array.length; i++) {
                randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
                array[i] = randomState;
              }
              return array;
            };
            // Freeze model/cache timestamps for paired parity checks, while
            // preserving the actual 700ms request pacing on the wall clock.
            waitForSearchSlot = async () => {
              const elapsed = wallNow() - lastSearchRequestAt;
              if (elapsed < SEARCH_REQUEST_GAP_MS) await sleep(SEARCH_REQUEST_GAP_MS - elapsed);
              lastSearchRequestAt = wallNow();
            };
          }
          Math.random = () => 0.25;
          const now = Date.now();
          const makeTrack = i => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}${i >= 100 ? ' - Rework' : ''}`,
            artists: [{ id: `a${i}`, name: i < 100 ? `Good${i}` : `Unused${i % 1700}` }], album: { name: `Album ${i}` } });
          let tracks = Array.from({ length: poolSize }, (_, i) => makeTrack(i));
          localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now }))));
          localStorage.setItem(LASTFM_ARTIST_POOL_KEY, JSON.stringify(Array.from({ length: 1800 }, (_, i) => ({
            artist: i < 100 ? `Good${i}` : `Unused${i - 100}`, tags: ['rock'], sources: ['tag'], savedAt: now
          }))));
          localStorage.setItem(LASTFM_TRACK_POOL_KEY, JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({
            artist: i < 100 ? `Good${i}` : `Unused${i % 1700}`, track: i < 100 ? `Song ${i}` : `Unused song ${i}`,
            tags: ['rock'], sources: ['tag'], savedAt: now
          }))));
          // 600 valid, old plays: exercise parsing without blocking the good catalog.
          localStorage.setItem(HISTORY_KEY, JSON.stringify(Array.from({ length: 600 }, (_, i) => ({
            trackId: `old${i}`, trackName: `Old ${i}`, artistNames: [`Old artist ${i}`],
            playedAt: new Date(now - 20 * 86400000 - i * 1000).toISOString(), source: 'spotify'
          }))));
          localStorage.setItem(LASTFM_USER_KEY, 'benchmark'); lastFmUserInput.value = 'benchmark';
          let selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({
            id, name: profiles[id].name, genres: ['rock'], manualGenres: [], artists: people === 4 && target !== 60 ? ['Good0'] : ['Seed missing'], blockedArtists: [],
            categories: ['rock'], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] }
          }));
          if (people === 4 && target !== 60) { tracks[1].artists = tracks[0].artists; localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(tracks.map(track => ({ track, queries: ['genre:"rock"'], savedAt: now })))); }
          if (fixtureSource) ({ tracks, selected } = (0,eval)(`(${fixtureSource})`)({people,poolSize,variant}));
          const referenceSelected = selected.map((p,index)=>({ ...p, manualGenres: ['classic rock','blues','jazz'], genres:[...new Set(['classic rock','blues','jazz',...(p.taste?.likedGenres||[])])], artists:index===0?['Fixture Artist 0','Fixture Artist 1','Seed outside pool']:['Fixture Artist 2','Fixture Artist 3'] }));
          for(const p of referenceSelected) p.categories=genreCategories(p.genres);
          const historyAtStart=variants?loadHistory().filter(row=>new Date(row.playedAt).getTime()<=now):[];
          if(variantSource) (0,eval)(`(${variantSource})`)(variant,referenceSelected);
          selectedProfiles = () => selected;
          getValidAccessToken = async () => 'mock-token';
          playlistLength.value = String(target); discoveryLevel.value = '30';
          // Warm means fresh history/tag TTLs plus every page of the actual queries
          // this fixture will consider. Empty cached pages are valid negative cache.
          if (cache === 'warm') {
            for (const key of [LASTFM_AUTO_TAG_SYNC_KEY, LASTFM_AUTO_RECENT_SYNC_KEY, RECENT_HISTORY_SYNC_KEY]) localStorage.setItem(key, String(now));
            localStorage.setItem(LASTFM_RECENT_OBSERVATION_KEY, JSON.stringify({ user: 'benchmark', observedAt: now, count: 0, complete: true }));
            const rotationKey = 'office_lastfm_source_rotation_v1', rotation = localStorage.getItem(rotationKey);
            const cacheGroups = variants ? [referenceSelected, referenceSelected.map(p=>({...p,manualGenres:[],genres:p.taste.likedGenres,categories:genreCategories(p.taste.likedGenres)}))] : [selected];
            const queries=[];
            for(const cacheProfiles of cacheGroups) {
              if (rotation === null) localStorage.removeItem(rotationKey); else localStorage.setItem(rotationKey, rotation);
              const names=cacheProfiles.flatMap(p=>lastFmArtistsForTags([...p.genres,...p.categories.flatMap(commonCategoryLastFmTags)],18,{includeRecent:p.id==='bartek'}));
              queries.push(...cacheProfiles.flatMap(p=>p.artists.map(a=>`artist:"${a}"`)),...cacheProfiles.flatMap(p=>p.genres.map(genre=>`genre:"${normalizeGenreName(genre)}"`)),...tasteCommonGenreQueries(cacheProfiles),...exactCommonGenreQueries(cacheProfiles),...names.map(name=>`artist:"${name}"`));
            }
            if (rotation === null) localStorage.removeItem(rotationKey); else localStorage.setItem(rotationKey, rotation);
            for (const query of new Set(queries)) for (let offset = 0; offset <= 90; offset += 10) {
              const matching = tracks.filter(track => queryMatchesTrack(query, track));
              writeSearchCache(query, offset, matching.slice(offset, offset + 10));
            }
          }
          if (caseKind === 'blocked') localStorage.setItem(FEEDBACK_BLOCKED_ARTISTS_KEY, JSON.stringify({ good0: { name: 'Good0' } }));
          if (caseKind === 'expired-cache') localStorage.setItem(searchCacheKey('artist:"Seed missing"', 0), JSON.stringify({ savedAt: now - SEARCH_CACHE_TTL_MS - 1, items: [] }));
          let datasetDigest;
          if(variants) {
            const keys=[CANDIDATE_POOL_KEY,LASTFM_ARTIST_POOL_KEY,LASTFM_TRACK_POOL_KEY,HISTORY_KEY,TASTE_STORAGE_KEY,LASTFM_USER_KEY,
              ...referenceSelected.flatMap(p=>[`office_genres_${p.id}`,`office_seed_${p.id}`]),...Object.keys(localStorage).filter(key=>key.startsWith(SEARCH_CACHE_PREFIX))].sort();
            const bytes=new TextEncoder().encode(JSON.stringify(keys.map(key=>[key,localStorage.getItem(key)])));
            datasetDigest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
          }
          const pools = () => ({ spotify: loadCandidatePool().length, artists: loadLastFmArtistPool().length, tracks: loadLastFmTrackPool().length });
          const before = pools(), requests = [], written = [];
          let remoteState = {}, searchRequests = 0;
          window.fetch = async (input, options = {}) => {
            const url = new URL(input, location.href), method = options.method || 'GET';
            const started = performance.now();
            if (transportDelayMs) await new Promise(resolve => setTimeout(resolve, transportDelayMs));
            requests.push({ ...(variants?{query:url.searchParams.get("q"),lastfmMethod:url.searchParams.get("method"),lastfmTag:url.searchParams.get("tag")}:{}), host: url.hostname, path: url.pathname, method, serviceMs: performance.now() - started });
            if (url.hostname === 'ws.audioscrobbler.com') {
              const action = url.searchParams.get('method');
              if (action === 'tag.getTopArtists') return Response.json({ topartists: { artist: [] } });
              if (action === 'tag.getTopTracks') return Response.json({ tracks: { track: [] } });
              if (action === 'user.getRecentTracks') return Response.json({ recenttracks: { track: [], '@attr': { page: '1', totalPages: '0' } } });
            }
            if (url.pathname === '/v1/me') return Response.json({ id: 'mock-owner', account_id: 'mock-owner' });
            if (url.pathname === '/v1/me/player/recently-played') return Response.json({ items: [] });
            if (url.pathname === '/v1/me/playlists' && method === 'GET') return Response.json({ items: [], next: null });
            if (url.pathname === '/v1/me/playlists' && method === 'POST') return Response.json({ id: 'mock-playlist', name: 'Benchmark', uri: 'spotify:playlist:mock-playlist' });
            if (url.pathname === '/v1/playlists/mock-playlist/items') {
              written.push(...JSON.parse(options.body).uris); return Response.json({ snapshot_id: 'mock' });
            }
            if (url.pathname === '/v1/search') {
              searchRequests++;
              if (caseKind === 'network') throw new TypeError('Mock Spotify network unavailable');
              if (caseKind === '429' && searchRequests === 1) return Response.json({ error: { status: 429 } }, { status: 429, headers: { 'Retry-After': '1' } });
              if (caseKind === 'changed-profiles' && searchRequests === 1) { await Promise.resolve(); selected.at(-1).taste.likedGenres = ['Jazz']; }
              if (caseKind === 'no-results') return Response.json({ tracks: { items: [] } });
              const query = url.searchParams.get('q'), offset = Number(url.searchParams.get('offset'));
              if(freshResults && fixtureSource) {
                const hash=[...query].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,7);
                const artist=extractQuotedQueryValue(query,'artist')||`Fixture Artist ${500+hash%100}`;
                return Response.json({tracks:{items:Array.from({length:10},(_,i)=>({id:`new${hash}-${offset+i}`,uri:`spotify:track:new${hash}-${offset+i}`,name:`New fixture ${hash}-${offset+i}`,artists:[{id:`newartist${hash}`,name:artist}],album:{name:'Fresh fixture album'}}))}});
              }
              return Response.json({ tracks: { items: tracks.filter(track => queryMatchesTrack(query, track)).slice(offset, offset + 10) } });
            }
            if (url.pathname === '/api/state') {
              if (method === 'PUT') { remoteState = JSON.parse(options.body).state; return Response.json({ ok: true, saved: Object.keys(remoteState).length }); }
              return Response.json({ ok: true, state: remoteState });
            }
            throw new Error(`Unexpected mock request: ${method} ${url.pathname}`);
          };
          const metrics = {}, stack = [], originals = new Map();
          const functions = ['generateOfficePlaylist', 'cleanupOldOfficePlaylists', 'refreshLastFmBeforeGeneration', 'syncSpotifyRecentHistory',
            'createCandidateAcquisition', 'getAcquisitionCoverage', 'primeManualSeedArtists', 'primeProfileGenres', 'primeCommonGroupQueries', 'acquisitionCoverage',
            'buildGroupRecommendationContext', 'eligibleGroupCandidates', 'selectGroupPlaylist', 'sequencePlaylistForListening',
            'buildPlaylistDiagnostics', 'createPlaylist', 'addItemsToPlaylist', 'saveRecentPlaylistSnapshot', 'renderPlaylistResult', 'uploadCloudStateIfChanged',
            'readSearchCache', 'saveCandidatePool', 'retainSpotifyPool', 'loadCandidatePool', 'createLastFmEvidenceSnapshot', 'loadLastFmArtistPool', 'loadLastFmTrackPool',
            'lastFmEvidenceForTrack', 'recognizabilityScore', 'trackDiagnostic', 'waitForSearchSlot', 'fetch'];
          let selection, finalResult;
          for (const name of instrument ? functions : ['generateOfficePlaylist', 'selectGroupPlaylist']) {
            const original = window[name];
            if (typeof original !== 'function') throw new Error(`Missing benchmark function ${name}`);
            originals.set(name, original);
            window[name] = function (...args) {
              const entry = { started: performance.now(), children: 0 }; stack.push(entry);
              const finish = () => {
                if (stack.at(-1) !== entry) throw new Error('Overlapping benchmark stack');
                const ms = performance.now() - entry.started; stack.pop();
                if (stack.length) stack.at(-1).children += ms;
                const row = metrics[name] ||= { calls: 0, inclusiveMs: 0, exclusiveMs: 0 };
                row.calls++; row.inclusiveMs += ms; row.exclusiveMs += ms - entry.children;
              };
              try {
                const value = original.apply(this, args);
                if (name === 'selectGroupPlaylist') { finalResult=value; selection = {
                  min: Math.min(...[...value.details.values()].flatMap(row => Object.values(row.byUser))),
                  discovery: value.discoveryCount, maxDiscovery: value.discoveryQuota.max,
                  artistCounts: Object.fromEntries(value.tracks.flatMap(track => [...trackArtistKeys(track)]).reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map()))
                }; }
                if (value && typeof value.then === 'function') return value.finally(finish);
                finish(); return value;
              } catch (error) { if (stack.at(-1) === entry) finish(); throw error; }
            };
          }
          await generateOfficePlaylist();
          for (const [name, original] of originals) window[name] = original;
          const snapshot = loadRecentPlaylists()[0];
          const expectedFailure = ['network', 'changed-profiles'].includes(caseKind);
          if (!expectedFailure && (!snapshot || written.length !== snapshot.tracks.length || !written.length)) throw new Error(`Generation failed: ${playlistResult.textContent}`);
          if (expectedFailure && written.length) throw new Error('Expected failure wrote tracks');
          let experiment;
          if(variants && snapshot) {
            const rows=loadCandidatePool(), evidence=createLastFmEvidenceSnapshot();
            const reference=buildGroupRecommendationContext(referenceSelected,rows,evidence);
            const own=buildGroupRecommendationContext(selected,rows,evidence);
            const scores=ctx=>Object.fromEntries(ctx.selected.map(p=>{
              const values=snapshot.tracks.map(track=>groupCandidateStatic(track,ctx).byUser[p.id].score);
              return [p.id,{average:values.reduce((a,b)=>a+b,0)/Math.max(1,values.length),minimum:values.length?Math.min(...values):null,below35:values.filter(v=>v<35).length}];
            }));
            const knownIds=new Set(historyAtStart.filter(r=>['spotify','lastfm'].includes(r.source)).map(r=>r.trackId).filter(Boolean));
            const knownSignatures=new Set(historyAtStart.filter(r=>['spotify','lastfm'].includes(r.source)).map(r=>trackSignatureFromParts(r.trackName,r.artistNames)));
            const known=snapshot.tracks.filter(track=>knownIds.has(track.id)||knownSignatures.has(trackSignature(track))).length;
            const artists=new Set(snapshot.tracks.flatMap(track=>track.artists.map(a=>a.id||normalizeArtistName(a.name))));
            experiment={variant,datasetDigest,ownScores:scores(own),referenceAScores:scores(reference),discovery:finalResult.discoveryCount,historyKnown:known,historyKnownShare:known/Math.max(1,snapshot.tracks.length),distinctArtists:artists.size};
          }
          return { people, cache, target, poolSize, caseKind, ...(fixtureSource?{progressReport:lastGenerationReport}:{}), ...(variants?{experiment}:{}), appVersion: document.querySelector('h1 .version').textContent, before, after: pools(), metrics, requests, selection: selection || null, searches: newSearchesThisGeneration,
            length: written.length, ids: (snapshot?.tracks || []).map(track => track.id), disabled: generateButton.disabled,
            diagnostics: (snapshot?.tracks || []).map(track => track.diagnostic),
            stateBytes: new TextEncoder().encode(JSON.stringify({ state: remoteState })).length };
        }, { people, cache, transportDelayMs, instrument, fixedClock, baseline, target, poolSize, caseKind, fixtureSource, variant, variantSource, variants, freshResults });
        assert.deepEqual(session.errors, []);
        if(variants) {
          assert.ok(output.experiment?.datasetDigest);
          const key=JSON.stringify([people,cache,target,poolSize,caseKind,iteration]);
          if(datasetDigests.has(key)) assert.equal(output.experiment.datasetDigest,datasetDigests.get(key),'A/B/C must share exactly the same initial data and cache');
          else datasetDigests.set(key,output.experiment.datasetDigest);
          if(variant!=='A') assert.ok(output.requests.filter(r=>r.path==='/v1/search').every(r=>!/^artist:"(?:Fixture Artist [0-3]|Seed outside pool)"$/i.test(r.query)),'Seed refresh escaped experiment policy');
        }
        assert.deepEqual(output.before, { spotify: poolSize, artists: fixtureSource ? 1777 : 1800, tracks: fixtureSource ? 2628 : 3000 });
        assert.equal(output.disabled, false); assert.ok(output.searches <= (target <= 60 ? 12 : 16));
        if (output.selection) assert.ok(output.selection.min >= 35);
        if (output.selection) assert.ok(output.selection.discovery <= output.selection.maxDiscovery);
        if (output.selection) assert.ok(Object.values(output.selection.artistCounts).every(count => count <= 2));
        assert.ok(output.stateBytes <= 2 * 1024 * 1024);
        if (cache === 'warm') assert.equal(output.searches, 0);
        if (iteration) samples.push(output);
      } finally { await session.close(); }
    }
    const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
    if(fixtureSource) process.stderr.write(`Finished ${baseline ? "baseline" : "candidate"} ${people}/${cache}/${variant}: ${samples[0].length} tracks\n`);
    results.push({ people, cache, target, poolSize, caseKind, ...(variants?{variant}:{}), samples: samples.length,
      totalP95Ms: p95(samples.map(row => row.metrics.generateOfficePlaylist.inclusiveMs)),
      functions: Object.fromEntries([...new Set(samples.flatMap(row => Object.keys(row.metrics)))].map(name => [name, {
        calls: samples.map(row => row.metrics[name]?.calls || 0),
        inclusiveP95Ms: p95(samples.map(row => row.metrics[name]?.inclusiveMs || 0)),
        exclusiveP95Ms: p95(samples.map(row => row.metrics[name]?.exclusiveMs || 0))
      }])), raw: samples });
  }
  console.log(JSON.stringify({ appVersion: results[0].raw[0].appVersion, baselineCommit: baseline?.commit || null, fixedClock, repetitions, transportDelayMs, instrument, freshResults,
    note: 'Synthetic Chromium full-pipeline audit, no live network. Cold/warm application caches, not machine disk cache. Original 700ms search pacing preserved. Nested inclusive times overlap; exclusive times partition each run. Last.fm cold mock returns valid empty responses, not a populated network backfill. p95 with five samples is the sample maximum, not a production percentile.', results }, null, 2));
} finally { await harness.close(); }
