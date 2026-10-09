// Read-only production audit: runs the real pipeline against local synthetic state
// and a closed mock transport. No application code or live services are changed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startBrowserHarness } from '../helpers/browser.mjs';

const repetitions = Number(process.env.OMM_BENCH_REPETITIONS || 5);
const transportDelayMs = Number(process.env.OMM_BENCH_API_DELAY_MS || 0);
const instrument = process.env.OMM_BENCH_INSTRUMENT !== '0';
const fixedClock = process.env.OMM_BENCH_FIXED_CLOCK === '1';
const baseline = process.env.OMM_BENCH_BASELINE ? JSON.parse(readFileSync(process.env.OMM_BENCH_BASELINE, 'utf8')) : null;
assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 20);
assert.ok(Number.isFinite(transportDelayMs) && transportDelayMs >= 0 && transportDelayMs <= 1000);
const harness = await startBrowserHarness();
const results = [];
try {
  for (const people of [2, 4]) for (const cache of ['cold', 'warm']) {
    const samples = [];
    for (let iteration = 0; iteration <= repetitions; iteration++) {
      const session = await harness.page();
      try {
        const output = await session.page.evaluate(async ({ people, cache, transportDelayMs, instrument, fixedClock, baseline }) => {
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
          const tracks = Array.from({ length: 2000 }, (_, i) => makeTrack(i));
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
          const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({
            id, name: profiles[id].name, genres: ['rock'], manualGenres: [], artists: ['Seed missing'], blockedArtists: [],
            categories: ['rock'], taste: { hasSurvey: true, likedGenres: ['Rock'], okGenres: [], blockedGenres: [] }
          }));
          selectedProfiles = () => selected;
          getValidAccessToken = async () => 'mock-token';
          playlistLength.value = '60'; discoveryLevel.value = '30';
          // Warm means fresh history/tag TTLs plus every page of the actual queries
          // this fixture will consider. Empty cached pages are valid negative cache.
          if (cache === 'warm') {
            for (const key of [LASTFM_AUTO_TAG_SYNC_KEY, LASTFM_AUTO_RECENT_SYNC_KEY, RECENT_HISTORY_SYNC_KEY]) localStorage.setItem(key, String(now));
            localStorage.setItem(LASTFM_RECENT_OBSERVATION_KEY, JSON.stringify({ user: 'benchmark', observedAt: now, count: 0, complete: true }));
            const rotationKey = 'office_lastfm_source_rotation_v1', rotation = localStorage.getItem(rotationKey);
            const names = selected.flatMap(p => lastFmArtistsForTags([...p.genres, ...p.categories.flatMap(commonCategoryLastFmTags)], 18, { includeRecent: p.id === 'bartek' }));
            if (rotation === null) localStorage.removeItem(rotationKey); else localStorage.setItem(rotationKey, rotation);
            const queries = ['artist:"Seed missing"', 'genre:"rock"', ...tasteCommonGenreQueries(selected), ...exactCommonGenreQueries(selected), ...names.map(name => `artist:"${name}"`)];
            for (const query of new Set(queries)) for (let offset = 0; offset <= 90; offset += 10) {
              const matching = tracks.filter(track => queryMatchesTrack(query, track));
              writeSearchCache(query, offset, matching.slice(offset, offset + 10));
            }
          }
          const pools = () => ({ spotify: loadCandidatePool().length, artists: loadLastFmArtistPool().length, tracks: loadLastFmTrackPool().length });
          const before = pools(), requests = [], written = [];
          let remoteState = {};
          window.fetch = async (input, options = {}) => {
            const url = new URL(input, location.href), method = options.method || 'GET';
            const started = performance.now();
            if (transportDelayMs) await new Promise(resolve => setTimeout(resolve, transportDelayMs));
            requests.push({ host: url.hostname, path: url.pathname, method, serviceMs: performance.now() - started });
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
              const query = url.searchParams.get('q'), offset = Number(url.searchParams.get('offset'));
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
            'createCandidateAcquisition', 'primeManualSeedArtists', 'primeProfileGenres', 'primeCommonGroupQueries', 'acquisitionCoverage',
            'buildGroupRecommendationContext', 'eligibleGroupCandidates', 'selectGroupPlaylist', 'sequencePlaylistForListening',
            'buildPlaylistDiagnostics', 'createPlaylist', 'addItemsToPlaylist', 'saveRecentPlaylistSnapshot', 'renderPlaylistResult', 'uploadCloudStateIfChanged',
            'readSearchCache', 'saveCandidatePool', 'retainSpotifyPool', 'loadCandidatePool', 'createLastFmEvidenceSnapshot', 'loadLastFmArtistPool', 'loadLastFmTrackPool',
            'lastFmEvidenceForTrack', 'recognizabilityScore', 'trackDiagnostic', 'waitForSearchSlot', 'fetch'];
          let selection;
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
                if (name === 'selectGroupPlaylist') selection = {
                  min: Math.min(...[...value.details.values()].flatMap(row => Object.values(row.byUser))),
                  discovery: value.discoveryCount, maxDiscovery: value.discoveryQuota.max,
                  artistCounts: Object.fromEntries(value.tracks.flatMap(track => [...trackArtistKeys(track)]).reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map()))
                };
                if (value && typeof value.then === 'function') return value.finally(finish);
                finish(); return value;
              } catch (error) { if (stack.at(-1) === entry) finish(); throw error; }
            };
          }
          await generateOfficePlaylist();
          for (const [name, original] of originals) window[name] = original;
          const snapshot = loadRecentPlaylists()[0];
          if (!snapshot || written.length !== snapshot.tracks.length || !written.length) throw new Error(`Generation failed: ${playlistResult.textContent}`);
          return { people, cache, appVersion: document.querySelector('h1 .version').textContent, before, after: pools(), metrics, requests, selection, searches: newSearchesThisGeneration,
            length: written.length, ids: snapshot.tracks.map(track => track.id), disabled: generateButton.disabled,
            diagnostics: snapshot.tracks.map(track => track.diagnostic),
            stateBytes: new TextEncoder().encode(JSON.stringify({ state: remoteState })).length };
        }, { people, cache, transportDelayMs, instrument, fixedClock, baseline });
        assert.deepEqual(session.errors, []);
        assert.deepEqual(output.before, { spotify: 2000, artists: 1800, tracks: 3000 });
        assert.equal(output.disabled, false); assert.ok(output.searches <= 12);
        assert.ok(output.selection.min >= 35);
        assert.ok(output.selection.discovery <= output.selection.maxDiscovery);
        assert.ok(Object.values(output.selection.artistCounts).every(count => count <= 2));
        assert.ok(output.stateBytes <= 2 * 1024 * 1024);
        if (cache === 'warm') assert.equal(output.searches, 0);
        if (iteration) samples.push(output);
      } finally { await session.close(); }
    }
    const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
    results.push({ people, cache, samples: samples.length,
      totalP95Ms: p95(samples.map(row => row.metrics.generateOfficePlaylist.inclusiveMs)),
      functions: Object.fromEntries([...new Set(samples.flatMap(row => Object.keys(row.metrics)))].map(name => [name, {
        calls: samples.map(row => row.metrics[name]?.calls || 0),
        inclusiveP95Ms: p95(samples.map(row => row.metrics[name]?.inclusiveMs || 0)),
        exclusiveP95Ms: p95(samples.map(row => row.metrics[name]?.exclusiveMs || 0))
      }])), raw: samples });
  }
  console.log(JSON.stringify({ appVersion: results[0].raw[0].appVersion, baselineCommit: baseline?.commit || null, fixedClock, repetitions, transportDelayMs, instrument,
    note: 'Synthetic Chromium full-pipeline audit, no live network. Cold/warm application caches, not machine disk cache. Original 700ms search pacing preserved. Nested inclusive times overlap; exclusive times partition each run. Last.fm cold mock returns valid empty responses, not a populated network backfill. p95 with five samples is the sample maximum, not a production percentile.', results }, null, 2));
} finally { await harness.close(); }
