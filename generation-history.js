/* LOG2 read-only diagnostics. No polling, preference writes or playlist operations. */
(function(root) {
  const names = {bartek:'Bartek',edyta:'Edyta',asia:'Asia',monika:'Monika'};
  const stages = ['Profile i sesja','Porządki Spotify','Last.fm','Historia Spotify','Artyści wzorcowi','Gatunki','Wspólne preferencje','Dobór utworów','Zapis Spotify','Diagnostyka i widok','Synchronizacja chmury'];
  const seconds = ms => `${(ms / 1000).toFixed(1)} s`;
  const date = value => new Date(value).toLocaleString('pl-PL');
  const line = (parent,text) => { const p=document.createElement('p'); p.className='small'; p.textContent=text; parent.append(p); };
  function card(entry,source,receivedAt) {
    const article=document.createElement('article'); article.className='generation-history-card';
    const title=document.createElement('h4'); title.textContent=`${entry.version} · ${entry.length}/${entry.requested} utworów · ${entry.outcome==='success'?'gotowe':'przerwane'}`; article.append(title);
    line(article,`${source} · koniec: ${date(entry.finishedAt)}${receivedAt?` · przyjęcie przez serwer: ${date(receivedAt)}`:''}`);
    line(article,`${entry.profiles.map(id=>names[id]).join(', ') || 'Brak wybranych profili'} · czas: ${seconds(entry.totalMs)} · wyszukiwania: ${entry.counters.searches ?? 0}/${entry.counters.budget ?? 0}`);
    const s=entry.selection;
    if(s) {
      line(article,`Odkrycia: ${s.discovery}/${entry.length} (${entry.length?(100*s.discovery/entry.length).toFixed(1):'0.0'}%), maksimum ${s.maximumDiscovery} · różni wykonawcy: ${s.distinctArtists}`);
      line(article,`Dopasowanie: ${Object.entries(s.profiles).map(([id,p])=>`${names[id]} ${p.average.toFixed(1)} (mocne: ${p.strong}, słabe: ${p.weak})`).join(' · ') || 'brak pomiaru'}`);
      if(entry.length<entry.requested) line(article, s.stop
        ? `Krótszy wynik — pozostało: ${s.stop.remaining ?? 0}; limit wykonawcy: ${s.stop.artistLimitBlocked ?? 0}; duplikaty: ${s.stop.duplicateBlocked ?? 0}; baza poniżej 35: ${s.stop.baseBelow35 ?? 0}. Liczniki mogą się nakładać; pełne filtry poniżej.`
        : 'Krótszy wynik — szczegółowa przyczyna nie została zapisana.');
    } else line(article,entry.playlistCreated?'Spotify potwierdziło utworzenie playlisty; zapis mógł być częściowy. Brak końcowej oceny doboru.':'Brak potwierdzenia utworzenia playlisty.');
    const lf=entry.cloud.lastfm;
    const status={not_run:'nie wykonano',success:lf.written?'potwierdzono zapis':'zakończono odczyt',skipped:'poprzednie potwierdzenie, bez nowego zapisu',error:'błąd, dane lokalne zachowano'};
    line(article,`Preferencje w chmurze: ${{not_run:'nie wykonano',success:'sukces',error:'błąd'}[entry.cloud.state]} · Last.fm: ${status[lf.status]}${lf.artists===null?'':` · ${lf.artists} wykonawców, ${lf.tracks ?? '?'} utworów, ${lf.bytes ?? '?'} bajtów`}`);
    const details=document.createElement('details'),summary=document.createElement('summary'); summary.textContent='Etapy, filtry i szczegóły techniczne'; details.append(summary);
    const list=document.createElement('ol'); entry.stages.forEach((s,i)=>{const li=document.createElement('li');li.textContent=`${stages[i]}: ${{done:'zakończono',waiting:'nie rozpoczęto',error:'błąd'}[s.status]} · ${seconds(s.ms)}`;list.append(li);}); details.append(list);
    const technical=document.createElement('pre'); technical.className='generation-history-technical';
    technical.textContent=`Bilans: praca ${seconds(entry.accounting.syncMs)}, oczekiwanie ${seconds(entry.accounting.waitMs)}, pozostałe ${seconds(entry.accounting.otherMs)}, w tle ${seconds(entry.accounting.hiddenMs)}\n`+
      `Metryki inclusive mogą się nakładać; exclusive usuwa zagnieżdżone pomiary.\n`+Object.entries(entry.metrics).map(([key,m])=>`${key}: ${m.calls} pomiarów, inclusive ${seconds(m.inclusiveMs)}, exclusive ${seconds(m.exclusiveMs)}`).join('\n')+
      `\nLiczniki: ${JSON.stringify(entry.counters)}\nFiltry: ${JSON.stringify(s?.filters ?? null)}\nZatrzymanie: ${JSON.stringify(s?.stop ?? null)}\nPozyskiwanie: ${JSON.stringify(s?.acquisition ?? null)}`;
    details.append(technical); article.append(details); return article;
  }
  function create({panel,button,status,rows,localRows,outcome,profile,version,getSession,authorize,refresh,request,readLocal,now=Date.now,timeout=()=>AbortSignal.timeout(5000)}) {
    let entries=[],owner='',epoch=0,busy=false,controller=null,backoff=null;
    const session=()=>getSession();
    const same=(account,turn)=>epoch===turn && session()?.account===account && Boolean(session()?.token);
    function reset() {
      epoch++; controller?.abort(); controller=null; busy=false; entries=[]; owner=''; backoff=null;
      rows.replaceChildren(); localRows.replaceChildren(); version.replaceChildren(new Option('Wszystkie wersje','')); outcome.value=''; profile.value=''; button.disabled=false;
      status.textContent='Połącz Spotify, aby odczytać historię tego konta.';
    }
    function render() {
      rows.replaceChildren(); localRows.replaceChildren();
      const active=session(); if(!active?.token || !active.account || active.account!==owner)return;
      const matches=e=>(!outcome.value || e.outcome===outcome.value) && (!profile.value || e.profiles.includes(profile.value)) && (!version.value || e.version===version.value);
      for(const row of entries.filter(row=>matches(row.entry)))rows.append(card(row.entry,'Chmura',row.receivedAt));
      if(!rows.childElementCount)line(rows,entries.length?'Brak wpisów pasujących do filtrów.':'Brak pobranej historii chmurowej.');
      try {
        const local=JSON.parse(readLocal() || 'null');
        if(local?.account===active.account && OfficeGenerationLog.valid(local.entry) && matches(local.entry) && !entries.some(row=>row.entry.id===local.entry.id))
          localRows.append(card(local.entry,'Kopia lokalna — tylko ostatnia próba; nie potwierdza zapisu w chmurze'));
      } catch {} // Corrupt/quota-blocked local data never replaces valid cloud records.
    }
    async function load() {
      if(busy)return;
      const active=session(); if(!active?.token || !active.account){reset();return;}
      if(owner!==active.account){reset();owner=active.account;}
      const account=active.account,turn=epoch;render();
      if(backoff?.account===account && now()<backoff.until){status.textContent='Limit API: odczekaj przed ponownym odświeżeniem. Dane poniżej zachowano.';return;}
      busy=true;button.disabled=true;status.textContent='Odczytuję historię generowań…'; controller=new AbortController();
      try {
        let token=await authorize(); if(!same(account,turn))return; if(!token)throw new Error('No session');
        const send=token=>request(token,'/api/generations?limit=100',{method:'GET',cache:'no-store',signal:AbortSignal.any([controller.signal,timeout()])});
        let response=await send(token);
        if(!same(account,turn))return;
        if(response.status===401){token=await refresh(token);if(!same(account,turn))return;if(!token)throw new Error('No session');response=await send(token);}
        if(!same(account,turn))return;
        if(response.status===401){status.textContent='Sesja Spotify odrzucona. Zaloguj się ponownie; lokalna diagnostyka pozostaje dostępna.';return;}
        const retry=response.headers.get('Retry-After');
        if([429,503].includes(response.status) && /^\d{1,6}$/.test(retry || '') && Number(retry)>0)backoff={account,until:now()+Number(retry)*1000};
        if(!response.ok)throw new Error('Unavailable');
        const data=await response.json(); if(!same(account,turn))return;
        if(data?.ok!==true || !Array.isArray(data.entries) || data.entries.length>100 || !data.entries.every(row=>row && OfficeGenerationLog.valid(row.entry) && typeof row.receivedAt==='string' && Number.isFinite(Date.parse(row.receivedAt))) || new Set(data.entries.map(row=>row.entry.id)).size!==data.entries.length)throw new Error('Invalid diagnostics');
        entries=data.entries;backoff=null;
        const selected=version.value; version.replaceChildren(new Option('Wszystkie wersje',''), ...[...new Set(entries.map(row=>row.entry.version))].map(v=>new Option(v,v))); if([...version.options].some(o=>o.value===selected))version.value=selected;
        status.textContent=`Historia chmurowa: ${entries.length} ostatnich wpisów tego konta (maks. 100).`; render();
      } catch {
        if(same(account,turn))status.textContent='Nie udało się odczytać dziennika. Możliwy brak aktywnej tabeli D1, błąd sesji lub sieci. Zachowano dostępne dane; generowanie playlist działa niezależnie.';
      } finally {if(epoch===turn){busy=false;controller=null;button.disabled=false;}}
    }
    button.addEventListener('click',load);
    panel.addEventListener('toggle',()=>{if(panel.open){const active=session();if(owner!==active?.account){reset();owner=active?.account || '';}render();}});
    for(const input of [outcome,profile,version])input.addEventListener('change',render);
    reset();return Object.freeze({load,reset,render});
  }
  root.OfficeGenerationHistory=Object.freeze({create});
})(globalThis);
