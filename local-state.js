/* Local preferences and recoverable import; never stores OAuth credentials. */
(function (root) {
  const PREFIX = 'office_', FORMAT = 'office-music-state', MARKER = 'omm_local_import_pending';
  let blocked = false;
  let pendingWrites = 0;
  function snapshot() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(PREFIX)) out[key] = localStorage.getItem(key); }
    return out;
  }
  function message(text, recovery = false) {
    let el = document.getElementById('localStateNotice');
    if (!el) { el = document.createElement('div'); el.id = 'localStateNotice'; el.setAttribute('role','alert'); el.style.cssText='padding:12px;margin:12px 0;border:1px solid currentColor;border-radius:10px;overflow-wrap:anywhere'; document.body.prepend(el); }
    el.replaceChildren(document.createTextNode(text));
    if (!recovery) return;
    const button = document.createElement('button'); button.type='button'; button.textContent='Pobierz kopię sprzed importu';
    button.addEventListener('click', () => downloadBackup().catch(() => message('Nie udało się odczytać kopii odzyskiwania.')));
    el.append(document.createElement('br'),button);
  }
  function quota(error) { return error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014; }
  function write(key, value) {
    if (blocked || localStorage.getItem(MARKER)) throw new Error('Import lub odzyskiwanie danych w toku.');
    try { localStorage.setItem(key,value); root.dispatchEvent(new CustomEvent("omm-state-change",{detail:{key}})); }
    catch (error) {
      if (quota(error)) {
        for (const candidate of Object.keys(snapshot())) if (/^office_(?:search|lastfm)_cache_v1:/.test(candidate)) localStorage.removeItem(candidate);
        try { localStorage.setItem(key,value); root.dispatchEvent(new CustomEvent("omm-state-change",{detail:{key}})); return; } catch (retry) { error=retry; }
      }
      message('Nie zapisano zmiany. Dotychczasowe dane pozostały zapisane. Zwolnij miejsce lub sprawdź dostęp do pamięci przeglądarki i spróbuj ponownie.');
      throw error;
    }
  }
  function conflict() {
    const error = new Error('Dane zmieniły się w innej karcie. Sprawdź aktualne oceny i ponów swój wybór.');
    error.name = 'LocalStateConflict';
    message(error.message);
    return error;
  }
  function equal(a,b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a)!==Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b,key) && equal(a[key],b[key]));
  }
  function merge(base,draft,latest) {
    if (equal(draft,base)) return latest;
    if (equal(latest,base) || equal(latest,draft)) return draft;
    if ([base,draft,latest].every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      const result = Object.create(null);
      for (const key of new Set([...Object.keys(base),...Object.keys(draft),...Object.keys(latest)])) {
        if (key === 'updatedAt') { if (draft[key] !== undefined) result[key] = draft[key]; continue; }
        const own = object => Object.hasOwn(object,key) ? object[key] : undefined;
        const value = merge(own(base),own(draft),own(latest));
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    throw conflict();
  }
  async function edit(key,base,value,{json=false,initial=null,strictPerson=null}={}) {
    if (typeof key!=='string' || !key.startsWith(PREFIX)) throw new Error('Nieprawidłowy klucz preferencji.');
    pendingWrites++;
    try {
      if (blocked || localStorage.getItem(MARKER)) throw new Error("Import lub odzyskiwanie danych w toku.");
      if (!navigator.locks) throw new Error('Ta przeglądarka nie obsługuje bezpiecznej edycji między kartami. Użyj aktualnej przeglądarki.');
      return await navigator.locks.request('omm-local-import', async () => {
        if (blocked || localStorage.getItem(MARKER)) throw new Error('Import lub odzyskiwanie danych w toku.');
        const journalKey=`edit:${key}`;
        const journal=await record(undefined,journalKey);
        let latest = localStorage.getItem(key);
        // Chromium can grant the lock before a different renderer receives storage events.
        // The durable journal identifies that exact stale predecessor; never overwrite it.
        if (journal && latest!==journal.value && latest===journal.before) {
          for (let attempt=0; attempt<25 && latest===journal.before; attempt++) {
            await new Promise(resolve => setTimeout(resolve,20));
            latest=localStorage.getItem(key);
          }
          if (latest===journal.before) { await record(null,journalKey); throw conflict(); }
        }
        if (blocked || localStorage.getItem(MARKER)) throw new Error('Import lub odzyskiwanie danych w toku.');
        let next = value;
        if (latest !== base) {
          if (!json || latest === null) throw conflict();
          let old, current, draft;
          try { old=JSON.parse(base ?? initial); current=JSON.parse(latest); draft=JSON.parse(value); }
          catch { throw conflict(); }
          if (strictPerson && !equal(old?.people?.[strictPerson]?.genres,current?.people?.[strictPerson]?.genres)) throw conflict();
          next=JSON.stringify(merge(old,draft,current));
        }
        // Save the fence before setItem. A failed write restores metadata, not application data.
        await record({before:latest,value:next},journalKey);
        // Legacy clients do not share the lock; reject a change observed while awaiting the fence.
        if (localStorage.getItem(key)!==latest) { await record(null,journalKey); throw conflict(); }
        try { write(key,next); }
        catch(error) { try { await record(journal ?? null,journalKey); } catch {} throw error; }
        return next;
      });
    } catch(error) {
      if (error.name!=='LocalStateConflict') message('Nie zapisano zmiany. Sprawdź dostęp do pamięci przeglądarki lub zakończ import i spróbuj ponownie.');
      throw error;
    } finally { pendingWrites--; }
  }
  function subscribe(callback) {
    let timer;
    function changed(key) {
      if (key !== null && key !== MARKER && !key?.startsWith(PREFIX)) return;
      clearTimeout(timer);
      timer=setTimeout(() => { if (!blocked && !localStorage.getItem(MARKER)) callback(); },0);
    }
    const storage = event => changed(event.key);
    const local = event => changed(event.detail.key);
    root.addEventListener('storage',storage);
    root.addEventListener('omm-state-change',local);
    return () => { clearTimeout(timer); root.removeEventListener('storage',storage); root.removeEventListener('omm-state-change',local); };
  }
  function record(value, key = 'latest') {
    return new Promise((resolve,reject) => {
      let abandoned = false;
      const request=indexedDB.open('omm-local-recovery',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('backup');
      request.onerror=()=>reject(request.error); request.onblocked=()=>{abandoned=true;reject(new Error('Kopia odzyskiwania jest zablokowana przez inną kartę.'));};
      request.onsuccess=()=>{
        const db=request.result;
        if (abandoned) { db.close(); return; }
        let tx;
        try { tx=db.transaction('backup', value === undefined ? 'readonly' : 'readwrite', {durability:'strict'}); }
        catch(error) { db.close(); reject(error); return; }
        const store=tx.objectStore('backup'), op=value === undefined ? store.get(key) : store.put(value,key);
        tx.oncomplete=()=>{db.close();resolve(value === undefined ? op.result : value);};
        tx.onerror=tx.onabort=()=>{db.close();reject(tx.error || new Error('Nie zapisano kopii odzyskiwania.'));};
      };
    });
  }
  function validate(payload, allowEmpty = false) {
    if (!payload || payload.format !== FORMAT || payload.version !== 1 || !payload.storage || typeof payload.storage !== 'object' || Array.isArray(payload.storage)) throw new Error('Nieprawidłowy format kopii OMM.');
    const entries=Object.entries(payload.storage);
    if ((!allowEmpty && !entries.length) || entries.length>20000 || new TextEncoder().encode(JSON.stringify(payload.storage)).byteLength>32*1024*1024) throw new Error('Kopia jest pusta albo przekracza limit rozmiaru.');
    for (const [key,value] of entries) {
      if (!key.startsWith(PREFIX) || key.length>2048 || /[\x00-\x1f]/.test(key) || typeof value !== 'string') throw new Error('Kopia zawiera nieprawidłowy klucz lub wartość.');
      const arrays=/^office_(?:candidate_pool|lastfm_artist_pool|lastfm_track_pool|music_history|played_history|recent_playlists)_v\d+$/.test(key);
      const objects=/^office_(?:taste_profile|feedback|feedback_blocked_artists|artist_exclusions|rmf_settings)_v\d+$/.test(key);
      if (arrays || objects) {
        let parsed; try { parsed=JSON.parse(value); } catch { throw new Error(`Nieprawidłowe dane: ${key}.`); }
        if (!parsed || typeof parsed!=='object' || (arrays ? !Array.isArray(parsed) : Array.isArray(parsed))) throw new Error(`Nieprawidłowa struktura: ${key}.`);
        if (key==='office_taste_profile_v1' && (parsed.version!==1 || !parsed.people || typeof parsed.people!=='object' || Array.isArray(parsed.people))) throw new Error('Nieprawidłowa ankieta w kopii.');
      }
    }
    return Object.fromEntries(entries);
  }
  function replace(state) {
    for (const key of Object.keys(snapshot())) localStorage.removeItem(key);
    for (const [key,value] of Object.entries(state)) localStorage.setItem(key,value);
  }
  async function importState(incoming) {
    incoming=validate({format:FORMAT,version:1,storage:incoming});
    const operation=async()=>{
      if (blocked) throw new Error('Najpierw odzyskaj poprzedni stan.');
      const before=snapshot(); blocked=true;
      const backup={format:FORMAT,version:1,storage:before,pending:true,savedAt:new Date().toISOString()};
      try {
        await record(backup); // Transaction completion precedes any destructive write.
        if (JSON.stringify(snapshot())!==JSON.stringify(before)) { await record({...backup,pending:false}); throw new Error('Dane zmieniły się podczas przygotowania importu. Spróbuj ponownie bez innych otwartych kart.'); }
        localStorage.setItem(MARKER, '1');
      } catch(error) { blocked=false; throw error; }
      try {
        replace(incoming);
        await record({...backup,pending:false});
        localStorage.removeItem(MARKER);
        blocked=false;
      } catch(error) {
        try { replace(before); await record({...backup,pending:false}); localStorage.removeItem(MARKER); blocked=false; }
        catch { message('Import i przywracanie nie powiodły się. Kopia sprzed importu jest zachowana. Pobierz ją; generowanie i synchronizacja pozostają wstrzymane do odzyskania danych.', true); }
        throw error;
      }
    };
    return navigator.locks ? navigator.locks.request('omm-local-import',operation) : operation();
  }
  async function recover() {
    let backup;
    try { backup=await record(); } catch {
      if (!localStorage.getItem(MARKER)) return true; // No import was started in this origin.
      blocked=true; message('Kopia przerwanego importu jest chwilowo niedostępna. Odblokuj pamięć przeglądarki i odśwież stronę. Generowanie i synchronizacja są wstrzymane.', true); return false;
    }
    if (!backup?.pending) {
      if (localStorage.getItem(MARKER) && !backup) { blocked=true; message('Brak kopii przerwanego importu. Przywróć dane z własnego eksportu przed dalszą pracą.', true); return false; }
      localStorage.removeItem(MARKER); return true;
    }
    blocked=true;
    try { validate(backup, true); replace(backup.storage); await record({...backup,pending:false}); localStorage.removeItem(MARKER); blocked=false; message('Przywrócono dane sprzed przerwanego importu. Kopia odzyskiwania pozostaje dostępna.'); return true; }
    catch { message('Nie udało się odzyskać przerwanego importu. Pobierz zachowaną kopię. Generowanie i synchronizacja są wstrzymane.', true); return false; }
  }
  async function downloadBackup() {
    const backup=await record(); if (!backup) throw new Error('Brak kopii odzyskiwania.');
    const url=URL.createObjectURL(new Blob([JSON.stringify({format:FORMAT,version:1,storage:backup.storage},null,2)],{type:'application/json'}));
    const link=document.createElement('a'); link.href=url;link.download='office-music-before-import.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  root.addEventListener('beforeunload', event => { if (pendingWrites) { event.preventDefault(); event.returnValue=''; } });
  root.OmmLocalState={write,edit,subscribe,validate,importState,recover,downloadBackup,snapshot,record,get pendingWrites(){return pendingWrites;},get blocked(){return blocked || !!localStorage.getItem(MARKER);}};
})(window);
