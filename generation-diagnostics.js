/* U4: presentation only. Existing diagnostics are moved, never recalculated. */
(function(root){
 const titles={result:'Wynik i ograniczenia',timing:'Etapy i wydajność',acquisition:'Pozyskiwanie i uczenie',data:'Dane i synchronizacja',model:'Model i pełne liczniki'};
 function create(panel){
  panel.replaceChildren();const heading=document.createElement('summary');heading.textContent='Diagnostyka generowania';panel.append(heading);
  const sections={};for(const [key,title] of Object.entries(titles)){const section=document.createElement('details'),summary=document.createElement('summary');summary.textContent=title;section.dataset.diagnosticSection=key;section.append(summary);panel.append(section);sections[key]=section;}return sections;
 }
 function finish(progress,result,context){
  let panel=result.querySelector('#playlistDiagnostics');if(!panel){panel=document.createElement('details');panel.id='playlistDiagnostics';panel.className='generator-details';result.prepend(panel);}
  const sections=panel.querySelector('[data-diagnostic-section]')?Object.fromEntries([...panel.querySelectorAll('[data-diagnostic-section]')].map(node=>[node.dataset.diagnosticSection,node])):create(panel);
  const technical=progress.querySelector('pre'), stages=progress.querySelector('ol');if(stages)sections.timing.append(stages);
  if(technical){const groups={timing:[],acquisition:[],data:[]};let audit=false;
   for(const line of technical.textContent.split('\n')){
    if(line.startsWith('Skuteczność Search'))audit=true;
    let key=/^(Usunięcia cache|Odczyty cache)/.test(line)?'data':/^(Rotacja Search|Zmiany kontekstu Search)/.test(line)?'acquisition':audit?'acquisition':'timing';
    groups[key].push(line);
   }
   for(const [key,lines] of Object.entries(groups)){if(!lines.some(line=>line.trim()))continue;const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';pre.textContent=lines.join('\n');if(key==='timing'){const more=document.createElement('details'),title=document.createElement('summary');title.textContent='Pomiary operacji';more.append(title,pre);sections.timing.append(more);}else sections[key].append(pre);}
   technical.closest('details').remove();
  }
  for(const node of [...progress.querySelectorAll('p')].slice(2))sections.data.append(node);
  const title=progress.querySelector('strong');if(title)title.remove();
  const summary=progress.querySelector('p');if(summary)summary.dataset.generationSummary='true';
  const data=document.createElement('p');data.textContent=context.data;sections.data.prepend(data);
  const copy=document.createElement('button');copy.type='button';copy.className='secondary';copy.textContent='Kopiuj raport diagnostyczny';
  const status=document.createElement('p');status.className='small';status.setAttribute('role','status');
  const report=()=>[context.header,summary?.textContent||'',progress.querySelectorAll('p')[1]?.textContent||'',...Object.entries(sections).map(([key,node])=>titles[key]+'\n'+[...node.children].filter(child=>child.tagName!=='SUMMARY').map(child=>child.tagName==='OL'?[...child.children].map(row=>row.textContent).join('\n'):child.tagName==='DETAILS'?[...child.children].map(row=>row.textContent).join('\n'):child.textContent).join('\n'))].filter(Boolean).join('\n\n');
  copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(report());status.textContent='Raport skopiowany.';}catch{status.textContent='Nie udało się skopiować. Zaznacz raport poniżej i skopiuj ręcznie.';const text=document.createElement('textarea');text.readOnly=true;text.value=report();text.setAttribute('aria-label','Raport diagnostyczny do ręcznego skopiowania');status.append(text);text.focus();text.select();}});
  panel.insertBefore(copy,panel.children[1]);panel.insertBefore(status,panel.children[2]);
  return panel;
 }
 root.OmmGenerationDiagnostics=Object.freeze({create,finish});
})(window);
