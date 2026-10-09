/* Historical diagnostic only: never used by playlist selection. */
(function (root) {
  const TTL = 15 * 60 * 1000;
  const text = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const title = value => text(value)
    .replace(/\s*\((?:feat\.?|ft\.?)\s+[^)]+\)\s*$/i, '')
    .replace(/\s*(?:-\s*|\()(?:\d{4}\s+)?(?:remaster(?:ed)?(?:\s+\d{4})?|album version)\)?\s*$/i, '').trim();
  const time = row => Date.parse(row.playedAt);
  function assess({ user, account, spotify, lastfm, spotifyObservation, lastfmObservation, now = Date.now() }) {
    const result = (status, extra = {}) => ({ status, user, account, checkedAt: now, ...extra });
    if (!user) return result('not_configured');
    if (!account) return result('insufficient_data');
    if (spotifyObservation?.account !== account || lastfmObservation?.user !== user) return result('insufficient_data');
    if ([spotifyObservation, lastfmObservation].some(o => o.error && now - o.observedAt < TTL)) return result('api_error');
    if ([spotifyObservation, lastfmObservation].some(o => !Number.isFinite(o.observedAt) || o.observedAt > now || now - o.observedAt > TTL)) return result('insufficient_data');
    const lf = lastfm.filter(r => r.sourceAccount === user && Number.isFinite(time(r)) && time(r) <= now);
    if (Number.isFinite(lastfmObservation.count) && lf.length < lastfmObservation.count) return result("insufficient_data");
    if (!lastfmObservation.complete && !Number.isFinite(lastfmObservation.oldest)) return result("insufficient_data");
    const floor = Math.max(Number.isFinite(spotifyObservation.oldest) ? spotifyObservation.oldest : 0, lastfmObservation.complete ? now - 14 * 86400000 : lastfmObservation.oldest + 12 * 60000);
    if (!Number.isFinite(floor)) return result('insufficient_data');
    const seen = new Set();
    const sp = spotify.filter(r => {
      const key = JSON.stringify([r.trackId, r.playedAt]);
      if (seen.has(key)) return false; seen.add(key);
      return r.sourceAccount === account && time(r) <= now - 30 * 60000 && time(r) >= Math.max(floor, now - 6 * 3600000);
    }).sort((a,b) => time(a) - time(b));
    if (!sp.length) return result('insufficient_data');
    const used = new Set();
    let matched = 0, streak = [];
    for (const row of sp) {
      const tolerance = Math.min(12 * 60000, Math.max(2 * 60000, Number(row.durationMs) || 0) + 2 * 60000);
      const candidates = lf.map((other, i) => ({ other, i, distance: Math.abs(time(row) - time(other)) }))
        .filter(({other, i, distance}) => !used.has(i) && distance <= tolerance
          && title(row.trackName) === title(other.trackName)
          && text(row.artistNames?.[0]) && text(row.artistNames?.[0]) === text(other.artistNames?.[0]))
        .sort((a,b) => a.distance - b.distance);
      if (candidates.length) { used.add(candidates[0].i); matched++; streak = []; }
      else streak.push(row);
    }
    const lastScrobble = lf.length ? Math.max(...lf.map(time)) : null;
    if (streak.length >= 5 && time(streak.at(-1)) - time(streak[0]) >= 30 * 60000) {
      return result('suspected_issue', { missing: streak.length, matched, lastScrobble, incident: `${account}:${user}:${Math.floor(time(streak[0]) / 60000)}` });
    }
    return result(matched && !streak.length ? 'healthy' : 'insufficient_data', { matched, lastScrobble });
  }
  function notice(previous, result, now = Date.now()) {
    if (result.status === 'healthy') return null;
    if (result.status !== 'suspected_issue') return previous;
    if (previous?.incident === result.incident && now - previous.since < 86400000) return previous;
    // A moving 50-item window must not cause a fresh alert every refresh.
    if (previous && previous.account === result.account && previous.user === result.user && now - previous.since < 86400000) return previous;
    return { incident: result.incident, account: result.account, user: result.user, since: now, dismissed: false };
  }
  root.OmmLastFmSync = { assess, notice, TTL };
})(globalThis);
