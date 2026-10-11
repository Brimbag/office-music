/* Q1.4: ephemeral, bounded Search diagnostics. No persistence or extra scoring. */
(function (root) {
  const reasons = { invalid: 'nieprawidłowy rekord', artistIdExcluded: 'wykluczone ID wykonawcy', feedbackTrack: 'ujemna ocena utworu', unwantedVariant: 'wersja alternatywna', explicitBlockedArtist: 'blokada wykonawcy', feedbackBlockedArtist: 'blokada feedbacku', strongNegativeArtistFeedback: 'silnie ujemny feedback wykonawcy', artistCooldown: 'cooldown wykonawcy', recentTrack: 'ostatnio odtwarzany', lowIndividualFit: 'minimum osoby', recognizability: 'rozpoznawalność', lowGroupFit: 'dopasowanie grupy', belowSafe: 'próg bezpiecznej selekcji' };
  const count = value => Number.isInteger(value) && value >= 0 ? value : null;
  root.OmmSearchEffectiveness = { create() {
    const pages = [], outcomes = new Map(), initialArtists = new Set(); let omitted = 0, final = false;
    return {
      baselineArtists(artists) { for (const artist of artists) initialArtists.add(artist); },
      begin(query, offset, stage, source) {
        if (pages.length >= 120) { omitted++; return null; }
        const page = { query: String(query).slice(0, 240), offset, stage, source, status: 'pending', raw: null, total: null, filtered: null, nameRejected: null, added: 0, updated: 0, ids: [] };
        pages.push(page); return page;
      },
      response(page, raw, items, total) {
        if (!page) return;
        page.status = 'ok'; page.raw = count(raw); page.total = count(total); page.filtered = items.length;
        page.nameRejected = page.raw === null ? null : Math.max(0, page.raw - items.length);
        page.ids = [...new Set(items.map(t => t?.id).filter(Boolean))];
      },
      error(page, status = null, network = true) { if (page) page.status = count(status) === null ? (network ? 'network-error' : 'error-unconfirmed') : `http-${status}`; },
      pool(page, added, updated, ids = []) { if (page) { page.added = added; page.updated = updated; page.newIds = ids; } },
      observe(track, reason) { if (track?.id && !outcomes.has(track.id)) outcomes.set(track.id, reason); },
      finish(poolByTrack, eligible, selected, qualifying, artistKeys) {
        final = true;
        const safe = new Map(eligible.filter(qualifying).map(item => [item.track.id, item.track]));
        const chosen = new Set(selected.map(t => t.id));
        for (const page of pages) {
          page.retained = page.ids.filter(id => poolByTrack.has(id)).length;
          page.safe = page.ids.filter(id => safe.has(id)).length;
          page.newSafe = (page.newIds || []).filter(id => safe.has(id)).length;
          const artists = new Set(page.ids.flatMap(id => safe.has(id) ? [...artistKeys(safe.get(id))] : []));
          page.artists = artists.size;
          page.newArtists = [...artists].filter(artist => !initialArtists.has(artist)).length;
          page.selected = page.ids.filter(id => chosen.has(id)).length;
          page.rejected = {};
          for (const id of page.ids) {
            if (!poolByTrack.has(id) || safe.has(id)) continue;
            const reason = outcomes.get(id) || 'belowSafe';
            page.rejected[reason] = (page.rejected[reason] || 0) + 1;
          }
        }
      },
      report() { return { final, omitted, pages: pages.map(({ ids, newIds, ...page }) => ({ ...page, rejected: { ...(page.rejected || {}) } })) }; },
      text() {
        const unknown = n => n === null ? '?' : n;
        return '\n\nSkuteczność Search — szczegóły lokalne tej próby (bez zapisu w chmurze).\nSurowe → po nazwach; nowe/aktualizowane: przed retencją. Bezpieczne i wybrane: końcowy stan; wkład zapytań może się nakładać.\n' + pages.map(p =>
          `${p.stage} · ${p.source} · ${p.query} · offset ${p.offset} · ${p.status}: ${unknown(p.raw)} → ${unknown(p.filtered)}, total ${unknown(p.total)}, odrzucone nazwy ${unknown(p.nameRejected)}; nowe ${p.added}, aktualizowane ${p.updated}` +
          (final ? `; w puli ${p.retained}, bezpieczne ${p.safe} (nowe rekordy ${p.newSafe}), wykonawcy ${p.artists} (nowi względem początku ${p.newArtists}), wybrane ${p.selected}; odrzucenia: ${Object.entries(p.rejected).map(([k,v]) => `${reasons[k] || k} ${v}`).join(', ') || 'brak'}` : '; końcowa kwalifikacja nieukończona')
        ).join('\n') + (omitted ? `\nPominięte strony diagnostyki: ${omitted}.` : '') + '\n? = brak metadanych w starszym cache. Zbiorcze odczyty cache przed wyszukiwaniem pozostają w liczniku stron cache.';
      }
    };
  } };
})(globalThis);
