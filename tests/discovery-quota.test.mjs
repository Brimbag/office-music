import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { startBrowserHarness } from './helpers/browser.mjs';
const context = {};
runInNewContext(readFileSync(new URL('../discovery-quota.js', import.meta.url), 'utf8'), context);
const { repair } = context.OfficeDiscoveryQuota;
const baseline = JSON.parse(readFileSync(new URL('./fixtures/selection-v43.17.json', import.meta.url), 'utf8'));
const quota = percent => n => ({ target: percent / 100, min: Math.max(0, Math.ceil(n * Math.max(0, percent / 100 - (percent > 0 && percent < 100 ? 0.05 : 0)) - 1e-9)), max: Math.min(n, Math.floor(n * Math.min(1, percent / 100 + (percent > 0 && percent < 100 ? 0.05 : 0)) + 1e-9)) });
const row = (id, discovery, artists = [id], score = 60) => ({ id, discovery, artists, signatures: [id], score, order: Number(id.replace(/\D/g, '')) || 0 });
function valid(result, total, q) {
  assert.ok(result.rows.length <= total);
  assert.ok(result.rows.filter(r => r.discovery).length <= q(result.rows.length).max);
  if (q(total).target === 1) assert.ok(result.rows.every(r => r.discovery));
  const ids = new Set(), signatures = new Set(), counts = new Map();
  for (const r of result.rows) {
    assert.ok(!ids.has(r.id)); ids.add(r.id);
    for (const key of r.signatures) { assert.ok(!signatures.has(key)); signatures.add(key); }
    for (const key of r.artists) counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert.ok([...counts.values()].every(n => n <= 2));
}

for (const percent of [0, 1, 5, 30, 50, 95, 100]) {
  test(`quota ${percent}%: zaokrąglenia, puste/krótkie wyniki i maksymalna długość bez konfliktów`, () => {
    const q = quota(percent);
    for (const total of [0, 1, 2, 10, 60, 90, 120]) for (const k of [0, 1, 10, 40]) {
      const candidates = [...Array.from({ length: k }, (_, i) => row(`k${i}`, false)), ...Array.from({ length: 130 }, (_, i) => row(`d${i}`, true))];
      const selected = candidates.slice(0, total);
      const before = JSON.stringify({ candidates, selected });
      const result = repair({ selected, candidates, total, quota: q });
      valid(result, total, q);
      let expected = total;
      while (expected > 0 && Math.max(0, expected - k) > q(expected).max) expected--;
      assert.equal(result.rows.length, expected);
      assert.equal(JSON.stringify({ candidates, selected }), before);
    }
  });
}

test('najpierw uzupełnienie: 31/60 z 21 odkryciami staje się pełnym poprawnym 60, bez usuwania', () => {
  const selected = [...Array.from({ length: 21 }, (_, i) => row(`d${i}`, true)), ...Array.from({ length: 10 }, (_, i) => row(`k${i}`, false))];
  const candidates = [...selected, ...Array.from({ length: 29 }, (_, i) => row(`extra${i}`, false))];
  const result = repair({ selected, candidates, total: 60, quota: quota(30) });
  valid(result, 60, quota(30));
  assert.equal(result.rows.length, 60); assert.equal(result.afterDiscovery, 21); assert.equal(result.removed, 0);
});

test('zastąpienie zwalnia limit wykonawcy: 3/4 odkrycia → 1/4 bez przycinania', () => {
  const selected = [row('d1', true, ['a'], 80), row('d2', true, ['a'], 80), row('d3', true, ['b'], 80), row('k1', false, ['b'])];
  const candidates = [...selected, row('replacementA', false, ['a']), row('replacementB', false, ['b'])];
  const result = repair({ selected, candidates, total: 60, quota: quota(30) });
  valid(result, 60, quota(30));
  assert.equal(result.rows.length, 4); assert.equal(result.afterDiscovery, 1); assert.equal(result.added, 2); assert.equal(result.removed, 2);
});

test('duety blokujące dwa katalogi: alternatywny zestaw daje 50 zamiast przyciętych 16', () => {
  const discovery = Array.from({ length: 20 }, (_, i) => row(`d${i}`, true, [`a${Math.floor(i / 2)}`, `b${Math.floor(i / 2)}`], 100));
  const known = Array.from({ length: 40 }, (_, i) => row(`k${i}`, false, [`${i % 4 < 2 ? 'a' : 'b'}${Math.floor(i / 4)}`]));
  const independent = Array.from({ length: 10 }, (_, i) => row(`independent${i}`, false));
  const selected = [...discovery, ...independent], candidates = [...selected, ...known];
  const result = repair({ selected, candidates, total: 60, quota: quota(30) });
  valid(result, 60, quota(30)); assert.equal(result.rows.length, 50); assert.equal(result.afterDiscovery, 0);
  assert.equal(result.minimumShortfall, 13); // Lower goal never forces a shorter safe set.
});

test('sygnatury alternatywnych wydań i limit współwykonawcy nie są omijane podczas zastąpień', () => {
  const selected = [row('d1', true, ['a'], 80), row('d2', true, ['a'], 80), row('d3', true, ['b'], 80), row('k1', false, ['c'])];
  const duplicate = { ...row('duplicate', false, ['a'], 100), signatures: ['k1'] };
  const result = repair({ selected, candidates: [...selected, duplicate], total: 60, quota: quota(30) });
  valid(result, 60, quota(30));
  assert.equal(result.rows.filter(r => r.signatures.includes('k1')).length, 1);
  assert.ok(!(result.rows.some(r => r.id === 'duplicate') && result.rows.some(r => r.id === 'k1')));
});

test('poprawny pełny wynik zachowuje kolejność i wszystkie wybrane ID mimo innych ocen alternatywy', () => {
  const selected = [row('k1', false), row('k2', false), row('d1', true)], candidates = [...selected, row('better', false, ['other'], 1000)];
  const result = repair({ selected, candidates, total: 3, quota: quota(30) });
  assert.deepEqual(Array.from(result.rows, r => r.id), selected.map(r => r.id)); assert.equal(result.added, 0); assert.equal(result.removed, 0);
});

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
async function evaluate(run, arg) {
  const session = await harness.page();
  try { const result = await session.page.evaluate(run, arg); assert.deepEqual(session.errors, []); return result; }
  finally { await session.close(); }
}

for (const people of [2, 4]) {
  for (const known of [1, 10, 15, 20, 27, 29]) {
    test(`${people} profile: regresja ${known + 21}/60, quota końcowa i spójne szczegóły/statystyki`, async t => {
      const result = await evaluate(({ people, known, source, quotaSource }) => {
        Math.random = () => 0.25; discoveryLevel.value = '30';
        const selected = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, artists: [], taste: {} }));
        const ctx = buildGroupRecommendationContext(selected);
        const items = Array.from({ length: known + 21 }, (_, i) => {
          const track = { id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ name: `Artist ${i}` }] };
          const item = groupCandidateStatic(track, ctx); item.groupBase = i < 21 ? 90 : 36;
          item.features.discovery = i < 21; item.minScore = 60; item.maxScore = 60;
          for (const p of selected) item.byUser[p.id].score = 60;
          return item;
        });
        const oldSelect = (0, eval)(`(${source})`);
        const summarize = output => ({ length: output.tracks.length, discovery: output.discoveryCount, max: output.discoveryQuota.max, repair: output.discoveryRepair, detailCount: output.details.size, detailDiscovery: [...output.details.values()].filter(d => d.discovery).length, fallback: output.rejectionStats.fallbackSelections, detailFallback: [...output.details.values()].filter(d => d.fallback).length, averages: Object.values(output.satisfaction).map(r => r.average), weak: Object.values(output.satisfaction).reduce((n, r) => n + r.weak, 0) });
        const currentQuota = discoveryQuotaForTotal;
        let before;
        try { discoveryQuotaForTotal = (0, eval)(`(${quotaSource})`); before = summarize(oldSelect(items, 60, ctx, newRejectionStats(items.length))); }
        finally { discoveryQuotaForTotal = currentQuota; }
        const after = summarize(selectGroupPlaylist(items, 60, ctx, newRejectionStats(items.length)));
        const final = selectGroupPlaylist(items, 60, ctx, newRejectionStats(items.length));
        const ordered = sequencePlaylistForListening(final.tracks);
        return { before, after, orderedDiscovery: ordered.filter(t => final.details.get(t.id).discovery).length, orderedLength: ordered.length };
      }, { people, known, source: baseline.source, quotaSource: baseline.quotaSource });
      assert.equal(result.before.length, known + 21); assert.equal(result.before.discovery, 21);
      assert.ok(result.before.discovery > result.before.max); assert.ok(result.after.discovery <= result.after.max);
      assert.equal(result.after.length, ({ 1: 1, 10: 15, 15: 23, 20: 30, 27: 41, 29: 44 })[known]);
      assert.equal(result.after.detailCount, result.after.length); assert.equal(result.after.detailDiscovery, result.after.discovery);
      assert.equal(result.after.fallback, result.after.detailFallback); assert.equal(result.after.weak, 0);
      assert.ok(result.after.averages.every(n => n === 60));
      assert.equal(result.orderedDiscovery, result.after.discovery); assert.equal(result.orderedLength, result.after.length);
      t.diagnostic(JSON.stringify({ people, known, ...result }));
    });
  }
  test(`${people} profile: współwykonawcy, bezpieczna przebudowa zwiększa długość 30 → 50 bez API`, async t => {
    const result = await evaluate(({ people, source, quotaSource }) => {
      Math.random = () => 0.25; discoveryLevel.value = '30';
      const profiles = ['bartek', 'asia', 'edyta', 'monika'].slice(0, people).map(id => ({ id, artists: [], taste: {} }));
      const ctx = buildGroupRecommendationContext(profiles), items = [];
      const make = (id, names, discovery) => {
        const track = { id, uri: `spotify:track:${id}`, name: id, artists: names.map(name => ({ name })) };
        const item = groupCandidateStatic(track, ctx); item.features.discovery = discovery; item.groupBase = discovery ? 100 : 36;
        item.minScore = 60; item.maxScore = 60; for (const p of profiles) item.byUser[p.id].score = 60; items.push(item);
      };
      for (let i = 0; i < 20; i++) make(`d${i}`, [`A${Math.floor(i / 2)}`, `B${Math.floor(i / 2)}`], true);
      for (let i = 0; i < 40; i++) make(`k${i}`, [`${i % 4 < 2 ? 'A' : 'B'}${Math.floor(i / 4)}`], false);
      for (let i = 0; i < 10; i++) make(`independent${i}`, [`Independent${i}`], false);
      const originalFetch = fetch; let calls = 0; window.fetch = () => { calls++; throw new Error('Unexpected API'); };
      try {
        const currentQuota = discoveryQuotaForTotal;
        let old;
        try { discoveryQuotaForTotal = (0, eval)(`(${quotaSource})`); old = (0, eval)(`(${source})`)(items, 60, ctx, newRejectionStats(items.length)); }
        finally { discoveryQuotaForTotal = currentQuota; }
        const next = selectGroupPlaylist(items, 60, ctx, newRejectionStats(items.length));
        const counts = {}; for (const t of next.tracks) for (const a of trackArtistKeys(t)) counts[a] = (counts[a] || 0) + 1;
        return { before: { length: old.tracks.length, discovery: old.discoveryCount }, after: { length: next.tracks.length, discovery: next.discoveryCount, max: next.discoveryQuota.max, repair: next.discoveryRepair, averages: Object.values(next.satisfaction).map(r => r.average) }, counts, calls };
      } finally { window.fetch = originalFetch; }
    }, { people, source: baseline.source, quotaSource: baseline.quotaSource });
    assert.equal(result.before.length, 30); assert.equal(result.before.discovery, 20);
    assert.equal(result.after.length, 50); assert.equal(result.after.discovery, 0); assert.equal(result.calls, 0);
    assert.ok(Object.values(result.counts).every(n => n <= 2)); assert.ok(result.after.averages.every(n => n === 60));
    t.diagnostic(JSON.stringify({ people, ...result }));
  });
}

test('korekta nie przywraca słabego profilu, ujemnego wykonawcy, blokady Spotify ID ani fallbacku z feedbackiem −40', async () => {
  const result = await evaluate(() => {
    discoveryLevel.value = '30'; Math.random = () => 0.25;
    const ctx = buildGroupRecommendationContext([{ id: 'bartek', artists: [], taste: {} }, { id: 'asia', artists: [], taste: {} }]);
    const id = '1111111111111111111111';
    setArtistExclusion({ id: 'idblock', name: 'idblock', artists: [{ id, name: 'idblock' }] }, id, 'wrong_artist');
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ prior: { value: -1, artists: ['bad'] } }));
    const rows = ['discovery', 'safeKnown', 'weak', 'bad', 'idblock', 'fallbackFeedback'].map(name => {
      const track = { id: name, uri: `spotify:track:${name}`, name, artists: [{ id: name === 'idblock' ? id : undefined, name }] };
      const item = groupCandidateStatic(track, ctx); item.groupBase = name === 'fallbackFeedback' ? 36 : 80; item.features.discovery = name === 'discovery';
      for (const p of ctx.selected) item.byUser[p.id].score = name === 'weak' && p.id === 'asia' ? 34.99 : 60;
      item.minScore = name === 'weak' ? 34.99 : 60;
      if (name === 'fallbackFeedback') item.features.feedback = -40;
      return item;
    });
    return selectGroupPlaylist(rows, 60, ctx, newRejectionStats(rows.length)).tracks.map(t => t.id);
  });
  assert.deepEqual(result, ['safeKnown']);
});

test('200 deterministycznych pul z duetami i duplikatami: quota, tożsamość, limity i wynik nie krótszy od samego przycięcia', () => {
  let seed = 432178;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let trial = 0; trial < 200; trial++) {
    const total = [1, 2, 10, 60, 90, 120][random(6)], q = quota([0, 5, 30, 50, 95, 100][random(6)]);
    const candidates = Array.from({ length: 150 }, (_, i) => ({ ...row(`t${i}`, Boolean(random(2)), [...new Set([`a${random(45)}`, `a${random(45)}`])], 35 + random(66)), signatures: [`signature${random(100)}`], order: i }));
    const selected = [], counts = new Map(), signatures = new Set();
    for (const r of candidates) {
      if (selected.length >= total) break;
      if (r.signatures.some(key => signatures.has(key)) || r.artists.some(key => (counts.get(key) || 0) >= 2)) continue;
      selected.push(r); for (const key of r.signatures) signatures.add(key);
      for (const key of r.artists) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const trimmed = selected.filter(r => q(total).target !== 1 || r.discovery);
    while (trimmed.filter(r => r.discovery).length > q(trimmed.length).max) trimmed.splice(trimmed.findLastIndex(r => r.discovery), 1);
    const result = repair({ selected, candidates, total, quota: q });
    valid(result, total, q); assert.ok(result.rows.length >= trimmed.length);
    const ids = new Set(candidates.map(r => r.id)); assert.ok(result.rows.every(r => ids.has(r.id)));
  }
});

test('decyzja produktu: 50 bezpiecznych utworów / 10% discovery wygrywa z poprawnymi 40 / 30%', () => {
  const known = Array.from({ length: 45 }, (_, i) => row(`known${i}`, false, [i < 28 ? `${i % 4 < 2 ? 'a' : 'b'}${Math.floor(i / 4)}` : `independent${i}`]));
  const oldDiscovery = Array.from({ length: 5 }, (_, i) => row(`oldDiscovery${i}`, true));
  const extraDiscovery = Array.from({ length: 7 }, (_, i) => row(`extraDiscovery${i}`, true, [`a${i}`, `b${i}`]));
  const selected = [...known, ...oldDiscovery], candidates = [...selected, ...extraDiscovery];
  const alternative = [...known.slice(0, 28).filter((_, i) => i % 2 === 0), ...known.slice(28, 42), ...oldDiscovery, ...extraDiscovery];
  assert.equal(alternative.length, 40); assert.equal(alternative.filter(r => r.discovery).length, 12);
  valid({ rows: alternative }, 60, quota(30));
  const result = repair({ selected, candidates, total: 60, quota: quota(30) });
  valid(result, 60, quota(30)); assert.equal(result.rows.length, 50); assert.equal(result.afterDiscovery, 5);
  assert.equal(result.removed, 0); assert.equal(result.minimumShortfall, 8);
});

test('podobna jakość (≤1 punkt groupBase na utwór) i długość: preferuj bliżej 30% bez wyrzucania znanych', () => {
  const selected = [...Array.from({ length: 6 }, (_, i) => row(`k${i}`, false)), ...Array.from({ length: 4 }, (_, i) => row(`d${i}`, true))];
  const candidates = [...selected, row('extra1', false, ['extra1'], 60.5), row('extra2', false, ['extra2'], 60.5)];
  const result = repair({ selected, candidates, total: 10, quota: quota(30) });
  valid(result, 10, quota(30)); assert.equal(result.rows.length, 10); assert.equal(result.afterDiscovery, 3);
  assert.ok(selected.filter(r => !r.discovery).every(r => result.rows.some(next => next.id === r.id)));
});

test('za mało discovery: dobierz bezpieczne odkrycia, bez usunięcia choćby jednego znanego', () => {
  const selected = Array.from({ length: 10 }, (_, i) => row(`k${i}`, false));
  const candidates = [...selected, ...Array.from({ length: 5 }, (_, i) => row(`d${i}`, true))];
  const result = repair({ selected, candidates, total: 20, quota: quota(30) });
  valid(result, 20, quota(30)); assert.equal(result.rows.length, 15); assert.equal(result.afterDiscovery, 5); assert.equal(result.removed, 0);
});

for (const percent of [0, 100]) test(`świadomy tryb ${percent}%: tylko ${percent === 0 ? 'znane' : 'discovery'}, także w realnym selektorze`, async () => {
  const result = await evaluate(percent => {
    discoveryLevel.value = String(percent);
    const ctx = buildGroupRecommendationContext([{ id: 'bartek', artists: [], taste: {} }]);
    const items = Array.from({ length: 6 }, (_, i) => {
      const track = { id: `t${i}`, uri: `spotify:track:t${i}`, name: `Song ${i}`, artists: [{ name: `Artist ${i}` }] };
      const item = groupCandidateStatic(track, ctx); item.features.discovery = i >= 3; item.groupBase = 80; item.minScore = 60; item.byUser.bartek.score = 60;
      return item;
    });
    const output = selectGroupPlaylist(items, 6, ctx, newRejectionStats(6));
    const onlyOpposite = selectGroupPlaylist(items.filter(item => item.features.discovery === (percent === 0)), 6, ctx, newRejectionStats(3));
    return { length: output.tracks.length, discovery: output.discoveryCount, empty: onlyOpposite.tracks.length, max: output.discoveryQuota.max, min: output.discoveryQuota.min };
  }, percent);
  assert.equal(result.length, 3); assert.equal(result.discovery, percent === 100 ? 3 : 0); assert.equal(result.empty, 0);
});

for (const n of [1, 2, 3, 16, 20, 36, 48, 50, 60]) test(`30%: twarde maksimum zaokrąglone w dół dla długości ${n}`, async () => {
  const result = await evaluate(n => { discoveryLevel.value = '30'; return discoveryQuotaForTotal(n); }, n);
  assert.equal(result.max, Math.floor(n * 35 / 100)); assert.ok(result.max / n <= 0.35);
  assert.equal(result.min, Math.ceil(n * 25 / 100));
});

test('diagnostyka UI odróżnia miękki niedobór od nadmiaru wstępnego i potwierdza brak końcowego przekroczenia', async () => {
  const result = await evaluate(() => {
    discoveryLevel.value = '30'; Math.random = () => 0.25;
    const selected = [{ id: 'bartek', name: 'Bartek', artists: [], taste: {} }];
    return ['below', 'excess'].map(mode => {
      const ctx = buildGroupRecommendationContext(selected);
      const items = Array.from({ length: mode === 'below' ? 5 : 4 }, (_, i) => {
        const track = { id: `${mode}${i}`, uri: `spotify:track:${mode}${i}`, name: `Song ${i}`, artists: [{ name: `Artist ${i}` }] };
        const item = groupCandidateStatic(track, ctx); item.features.discovery = mode === 'excess' && i < 3;
        item.groupBase = item.features.discovery ? 90 : 36; item.minScore = 60; item.byUser.bartek.score = 60;
        return item;
      });
      const output = selectGroupPlaylist(items, mode === 'below' ? 5 : 60, ctx, newRejectionStats(items.length));
      renderPlaylistResult({ id: 'test', external_urls: { spotify: 'https://open.spotify.com/playlist/test' } }, output.tracks, selected, [], mode === 'below' ? 5 : 60, null, output);
      return playlistResult.textContent;
    });
  });
  assert.match(result[0], /Discovery poniżej celu: brak bezpiecznych odkryć/);
  assert.match(result[0], /Discovery powyżej dozwolonego maksimum: 0 po korekcie; nadmiar w doborze wstępnym: 0/);
  assert.match(result[1], /Discovery powyżej dozwolonego maksimum: 0 po korekcie; nadmiar w doborze wstępnym: 2/);
});
