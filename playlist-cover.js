// Optional decoration of a newly created playlist; never changes selection.
(function (root) {
  const SIZE = 512, FOOTER = 64, MAX_PAYLOAD = 256000;
  function imageFor(track) {
    return (Array.isArray(track?.album?.images) ? track.album.images : []).filter(image => {
      try { const url = new URL(image.url); return url.protocol === 'https:' && url.hostname === 'i.scdn.co' && image.url.length <= 1024; } catch { return false; }
    }).sort((a, b) => Math.abs((a.width || 300) - 300) - Math.abs((b.width || 300) - 300))[0]?.url || '';
  }
  function choose(tracks, details) {
    const ranked = [...tracks].sort((a, b) => {
      const score = track => Number.isFinite(details?.get(track.id)?.final) ? details.get(track.id).final : -Infinity;
      return (score(b) - score(a)) || String(a.id).localeCompare(String(b.id), 'en');
    });
    const chosen = [], seen = new Set();
    for (const track of ranked) {
      const image = imageFor(track); if (image && seen.has(image)) continue;
      chosen.push(track); if (image) seen.add(image); if (chosen.length === 4) break;
    }
    for (const track of ranked) if (chosen.length < 4 && !chosen.includes(track)) chosen.push(track);
    return chosen;
  }
  function initials(people) {
    return people.map(person => Array.from(String(person?.name || '').trim())[0]?.toLocaleUpperCase('pl') || '').filter(Boolean).join(' • ');
  }
  function loadImage(url, signal) {
    return new Promise(resolve => {
      if (!url || signal.aborted) { resolve(null); return; }
      const image = new Image(); image.crossOrigin = 'anonymous';
      const finish = value => { image.onload = image.onerror = null; signal.removeEventListener('abort', abort); resolve(value); };
      const abort = () => { image.src = ''; finish(null); };
      signal.addEventListener('abort', abort, { once: true });
      image.onload = () => finish(image); image.onerror = () => finish(null); image.src = url;
    });
  }
  async function render(tracks, people, signal) {
    const images = await Promise.all(tracks.map(track => loadImage(imageFor(track), signal)));
    if (signal.aborted || !images.some(Boolean)) return null;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d'); if (!ctx) return null;
    ctx.fillStyle = '#191b1e'; ctx.fillRect(0, 0, SIZE, SIZE);
    const cellWidth = SIZE / 2, cellHeight = (SIZE - FOOTER) / 2;
    images.forEach((image, index) => {
      if (!image) return;
      // Contain the whole album image: no cropping, distortion, or text overlays.
      const scale = Math.min(cellWidth / image.naturalWidth, cellHeight / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      ctx.drawImage(image, (index % 2) * cellWidth + (cellWidth - width) / 2, Math.floor(index / 2) * cellHeight + (cellHeight - height) / 2, width, height);
    });
    ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(0, SIZE - FOOTER, SIZE, FOOTER);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(initials(people), 20, SIZE - FOOTER / 2, SIZE - 108);
    ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'right'; ctx.fillText('OMM', SIZE - 20, SIZE - FOOTER / 2);
    for (const quality of [0.85, 0.65, 0.45]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (!data.startsWith('data:image/jpeg;base64,')) return null;
      const body = data.slice(data.indexOf(',') + 1);
      if (body.length <= MAX_PAYLOAD) return body;
    }
    return null;
  }
  async function apply({ token, playlistId, tracks, details, people, request, timeoutMs = 15000 }) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const selected = choose(tracks, details);
      // Older candidate pools have no artwork. Resolve only these selected tracks,
      // without new Search requests or touching recommendation data.
      const enriched = await Promise.all(selected.map(async track => {
        if (imageFor(track)) return track;
        try {
          const response = await request(token, `https://api.spotify.com/v1/tracks/${encodeURIComponent(track.id)}`, { signal: controller.signal });
          if (!response.ok || controller.signal.aborted) return track;
          return { ...track, album: (await response.json()).album };
        } catch { return track; }
      }));
      if (controller.signal.aborted) return false;
      const available = [...enriched, ...tracks.filter(track => !selected.includes(track) && imageFor(track))];
      const body = await render(choose(available, details), people, controller.signal);
      if (!body || controller.signal.aborted) return false;
      const response = await request(token, `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/images`, {
        method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body, signal: controller.signal
      });
      return response.ok;
    } catch { return false; } finally { clearTimeout(timer); }
  }
  root.OfficePlaylistCover = { imageFor, choose, initials, render, apply };
})(globalThis);
