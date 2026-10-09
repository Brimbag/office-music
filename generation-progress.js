/* Aggregate generation telemetry; no identities, queries or credentials. */
(function (root) {
  const stages = ['Profile i sesja', 'Porządki Spotify', 'Last.fm', 'Historia Spotify', 'Artyści wzorcowi', 'Gatunki', 'Wspólne preferencje', 'Dobór utworów', 'Zapis Spotify', 'Diagnostyka i widok', 'Synchronizacja chmury'];
  const labels = { localPool: 'Odczyt lokalnej puli', coverage: 'Obliczanie pokrycia', coverageCheck: 'Sprawdzenie ważności pokrycia', qualification: 'Kwalifikacja kandydatów', searchCache: 'Odczyt cache Search', spotifyApi: 'Sieć Spotify', lastfmApi: 'Sieć Last.fm', throttle: 'Odstęp Search', retryWait: 'Oczekiwanie po 429', oauth: 'Odświeżenie OAuth' };
  root.OmmGenerationProgress = { create(container, target) {
    const started = performance.now(), stack = [], metrics = {}, warnings = [], counters = { queries: 0, skipped: 0, cachePages: 0, cacheContributed: 0, searches: 0, budget: 0, pool: 0, artists: 0, tracks: 0, coverageHits: 0, searchRequests: 0, cacheReadHits: 0, cacheReadMisses: 0, oauthAttempts: 0, oauthSuccess: 0, oauthFailure: 0 };
    let current = -1, ended = null, lastPaint = -Infinity, message = '', outcome = 'active', playlistCreated = false, length = 0;
    const rows = stages.map(name => ({ name, status: 'waiting', started: null, ms: 0, queries: 0, skipped: 0, cachePages: 0, searches: 0 }));
    container.textContent = '';
    const title = document.createElement('strong'); title.textContent = `Generowanie playlisty: ${target} utworów`;
    const basic = document.createElement('p'), note = document.createElement('p'), list = document.createElement('ol');
    basic.className = note.className = 'small'; list.className = 'generation-stages';
    const nodes = rows.map(() => { const node = document.createElement('li'); list.append(node); return node; });
    const details = document.createElement('details'), summary = document.createElement('summary'), technical = document.createElement('pre');
    summary.textContent = 'Szczegóły techniczne'; details.append(summary, technical); container.append(title, basic, note, list, details);
    const seconds = ms => `${(ms / 1000).toFixed(1)} s`;
    const elapsed = () => (ended ?? performance.now()) - started;
    const render = (force = false) => {
      const now = performance.now(); if (!force && now - lastPaint < 150) return; lastPaint = now;
      const row = rows[current], duration = row?.started === null ? 0 : row?.status === 'active' ? now - row.started : row?.ms || 0;
      basic.textContent = outcome === 'active'
        ? `Etap ${current + 1} z ${rows.length}: ${row?.name || 'Przygotowanie'} · czas etapu ${seconds(duration)} · łącznie ${seconds(elapsed())}. Nowe wyszukiwania Spotify: ${counters.searches}/${counters.budget}. Cache: ${counters.cachePages} stron. Pula: ${counters.pool}/2000; kwalifikowalni: ${counters.artists} wykonawców, ${counters.tracks} utworów.`
        : `${outcome === 'success' ? `Gotowe: ${length} utworów` : 'Generowanie przerwane'} · łącznie ${seconds(elapsed())} · nowe wyszukiwania ${counters.searches}/${counters.budget} · cache ${counters.cachePages} stron. ${outcome === 'error' ? (playlistCreated ? 'Playlista została już utworzona w Spotify; zapis utworów mógł być częściowy.' : 'Nie potwierdzono utworzenia playlisty w Spotify.') : ''}`;
      note.textContent = [message, ...warnings].filter(Boolean).join(' ');
      rows.forEach((item, i) => {
        nodes[i].dataset.status = item.status;
        nodes[i].textContent = `${item.status === 'done' ? '✓' : item.status === 'active' ? '→' : item.status === 'error' ? '!' : '·'} ${item.name}: ${item.status === 'waiting' ? 'oczekuje' : item.status === 'active' ? 'w toku' : seconds(item.ms)}${item.queries ? ` · zapytania sprawdzone ${item.queries}, pokryte ${item.skipped}, cache ${item.cachePages}, nowe ${item.searches}` : ''}`;
      });
      technical.textContent = Object.entries(metrics).map(([key, value]) => `${labels[key] || key}: ${value.calls} pomiarów, inclusive ${seconds(value.inclusiveMs)}, exclusive ${seconds(value.exclusiveMs)}`).join('\n') +
        `\nOdczyty cache: trafienia ${counters.cacheReadHits}, brak/wygasłe ${counters.cacheReadMisses}. Reuse pokrycia: ${counters.coverageHits}. Kandydaci dodani z cache: ${counters.cacheContributed}. Żądania Search (z retry): ${counters.searchRequests}. OAuth: prób ${counters.oauthAttempts}, sukces ${counters.oauthSuccess}, błędy ${counters.oauthFailure}.\nCzasy inclusive nakładają się; exclusive usuwa zagnieżdżone mierzone operacje synchroniczne. Etapy obejmują też pozostałą pracę.`;
    };
    const record = (name, start, children = 0) => { const ms = performance.now() - start, row = metrics[name] ||= { calls: 0, inclusiveMs: 0, exclusiveMs: 0 }; row.calls++; row.inclusiveMs += ms; row.exclusiveMs += Math.max(0, ms - children); return ms; };
    const visibility = () => { if (document.hidden) { message = 'Karta jest w tle. Uśpienie przez przeglądarkę może wstrzymać generowanie.'; } else if (outcome === 'active') { message = 'Karta znów aktywna. Stan poniżej opisuje ostatnie potwierdzone działania.'; } render(true); };
    document.addEventListener('visibilitychange', visibility);
    const timer = setInterval(() => { if (!document.hidden && outcome === 'active') render(); }, 1000); // Clock display only; never drives work.
    render(true);
    return {
      counters,
      stage(index) { const now = performance.now(); if (rows[current]?.status === 'active') { rows[current].status = 'done'; rows[current].ms = now - rows[current].started; } current = index; rows[index].status = 'active'; rows[index].started = now; message = ''; render(true); },
      note(text) { message = text; render(true); },
      warn(text) { warnings.push(text); render(true); },
      count(key, amount = 1) { counters[key] += amount; if (rows[current] && key in rows[current]) rows[current][key] += amount; render(); },
      update(values) { Object.assign(counters, values); render(); },
      created() { playlistCreated = true; },
      measure(name, operation) { const entry = { started: performance.now(), children: 0 }; stack.push(entry); try { return operation(); } finally { stack.pop(); const ms = record(name, entry.started, entry.children); if (stack.length) stack.at(-1).children += ms; render(); } },
      async measureAsync(name, operation) { const start = performance.now(); try { return await operation(); } finally { record(name, start); render(); } },
      finish(error = null, size = 0) { ended = performance.now(); outcome = error ? 'error' : 'success'; length = size; if (rows[current]) { rows[current].ms = ended - rows[current].started; rows[current].status = error ? 'error' : 'done'; } message = error ? `Etap: ${rows[current]?.name}. ${error.message}` : ""; clearInterval(timer); document.removeEventListener('visibilitychange', visibility); render(true); },
      report() { return { outcome, totalMs: elapsed(), playlistCreated, length, stages: rows.map(row => ({ ...row })), metrics: structuredClone(metrics), counters: { ...counters }, warnings: [...warnings] }; }
    };
  } };
})(window);
