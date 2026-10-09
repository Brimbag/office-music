// Executed only in an isolated test browser. Deliberately synthetic, not user data.
export function installP4Fixture({ people = 2, poolSize = 2000, variant = 'A' } = {}) {
  const now = Date.now();
  const labels = ['groove metal','gothic rock','new wave / post-punk','funk metal','industrial metal','nu metal','classic rock','thrash metal','alternative metal','indie pop','old school hip-hop','alternative hip-hop','hardcore punk','metalcore','synthpop','alternative rock','progressive metal','punk rock','metal','death metal','heavy metal','indie rock','grunge','hard rock','rock','garage rock','funk rock','punk','pop punk','pop rock'];
  const extra = ['mainstream pop','europop','symphonic metal','folk / singer-songwriter','contemporary r&b','britpop','celtic folk','new age','emo','pop rap','singer-songwriter','house','dance pop','trip-hop','folk rock','latin pop','indie folk','pop','folk'];
  const definitions = Object.entries(TASTE_GENRE_DEFS);
  const peopleState = {}, selected = ['bartek','asia','edyta','monika'].slice(0,people).map((id,index) => {
    const wanted = new Set((index % 2 ? [...labels.slice(3),...extra] : labels).map(genrePreferenceKey));
    const ratings = {}; let ok=0, no=0;
    for (const [key,def] of definitions) {
      if(wanted.has(genrePreferenceKey(def.label))) ratings[key]='like';
      else if(ok<70) { ratings[key]='ok';ok++; }
      else if(def.parent && no<45) { ratings[key]='no';no++; }
    }
    peopleState[profiles[id].name]={genres:ratings};
    const likedGenres=definitions.filter(([key])=>ratings[key]==='like').map(([,def])=>def.label);
    const okGenres=definitions.filter(([key])=>ratings[key]==='ok').map(([,def])=>def.label);
    const blockedGenres=definitions.filter(([key])=>ratings[key]==='no').map(([,def])=>def.label);
    const manualGenres=['classic rock','blues','jazz'];
    const artists=index===0?['Fixture Artist 0','Fixture Artist 1','Seed outside pool']:['Fixture Artist 2','Fixture Artist 3'];
    for(const [selector,value] of [[`input[data-genre-profile-id="${id}"]`,manualGenres.join(',')],[`input[data-seed-profile-id="${id}"]`,artists.join(',')],[`input[data-blocked-profile-id="${id}"]`,'']]) {
      const input=document.querySelector(selector); if(input) input.value=value;
    }
    localStorage.setItem(`office_genres_${id}`,manualGenres.join(',')); localStorage.setItem(`office_seed_${id}`,artists.join(','));
    const effectiveManual=variant==='A'?manualGenres:[];
    const genres=[...new Set([...effectiveManual,...likedGenres])];
    return {id,name:profiles[id].name,genres,manualGenres:effectiveManual,categories:genreCategories(genres),artists:variant==='B'?[]:artists,blockedArtists:[],taste:{hasSurvey:true,likedGenres,okGenres,blockedGenres}};
  });
  localStorage.setItem(TASTE_STORAGE_KEY,JSON.stringify({version:1,taxonomyVersion:2,people:peopleState}));
  const tracks=Array.from({length:poolSize},(_,i)=>({id:`p4t${i}`,uri:`spotify:track:p4t${i}`,name:`Fixture Song ${i}${i>=400?' - Rework':''}`,artists:[{id:`p4a${Math.floor(i/3)}`,name:`Fixture Artist ${Math.floor(i/3)}`}],album:{name:`Fixture Album ${i}`}}));
  const tagSets=[['rock','alternative rock','grunge'],['pop','dance pop','synthpop'],['metal','heavy metal','nu metal'],['folk rock','indie folk','singer-songwriter'],['jazz','blues'],['hard rock','funk rock']];
  localStorage.setItem(CANDIDATE_POOL_KEY,JSON.stringify(tracks.map((track,i)=>({track,queries:[`genre:"${tagSets[Math.floor(i/3)%tagSets.length][0]}"`],savedAt:now}))));
  localStorage.setItem(LASTFM_ARTIST_POOL_KEY,JSON.stringify(Array.from({length:1777},(_,i)=>({artist:`Fixture Artist ${i}`,tags:tagSets[i%tagSets.length],sources:['tag'],savedAt:now}))));
  localStorage.setItem(LASTFM_TRACK_POOL_KEY,JSON.stringify(Array.from({length:2628},(_,i)=>({artist:`Fixture Artist ${i<100?Math.floor(i/3):i%1777}`,track:i<100?`Fixture Song ${i}`:`Tag-only Song ${i}`,tags:tagSets[Math.floor(i/3)%tagSets.length],sources:['tag'],savedAt:now}))));
  localStorage.setItem(HISTORY_KEY,JSON.stringify(Array.from({length:657},(_,i)=>({trackId:i<50?`p4t${i}`:`history${i}`,trackName:i<50?`Fixture Song ${i}`:`History Song ${i}`,artistNames:[i<50?`Fixture Artist ${Math.floor(i/3)}`:`History Artist ${i}`],playedAt:new Date(now-(i<50?20:3)*86400000-i*1000).toISOString(),source:i<447?'lastfm':'spotify'}))));
  localStorage.setItem(LASTFM_USER_KEY,'benchmark');lastFmUserInput.value='benchmark';
  return {tracks,selected,seedNames:['Fixture Artist 0','Fixture Artist 1','Fixture Artist 2','Fixture Artist 3','Seed outside pool'],tagSets};
}
