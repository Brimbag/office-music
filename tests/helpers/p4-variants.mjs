// Sandbox-only policies; this module is not loaded by either production page.
export function installP4Variant(variant, referenceSelected) {
  if (!['A','B','C'].includes(variant)) throw new Error('Unknown experiment variant');
  if(variant==='A') return;
  const seeds=new Set(referenceSelected.flatMap(p=>p.artists||[]).map(normalizeArtistName));
  primeManualSeedArtists=async()=>{};
  const prime=primeDiverseQueries;
  primeDiverseQueries=(token,rows,...rest)=>prime(token,rows.filter(row=>!seeds.has(normalizeArtistName(extractQuotedQueryValue(row.query,'artist')))),...rest);
  const retention=retentionProfiles;
  const present=new Set(referenceSelected.map(p=>p.id));
  retentionProfiles=()=>retention().map(p=>present.has(p.id)?{...p,manualGenres:[],artists:variant==='B'?[]:p.artists}:p);
}
