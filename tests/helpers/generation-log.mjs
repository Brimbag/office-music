import { readFileSync } from 'node:fs';
import '../../generation-log.js';
export const entry=(id='00000000-0000-0000-0000-000000000001')=>({schema:1,id,version:'v43.34.LOG1',finishedAt:'2026-10-11T00:00:00.000Z',outcome:'success',requested:60,length:48,playlistCreated:true,profiles:['bartek','edyta'],totalMs:23900,accounting:{syncMs:11700,waitMs:11000,otherMs:1200,hiddenMs:0,maxTimerGapMs:1500},
 stages:Array.from({length:11},()=>({status:'done',ms:100})),counters:{searches:12,budget:12},metrics:{spotifyApi:{calls:19,inclusiveMs:4600,exclusiveMs:4600}},
 selection:{discovery:13,maximumDiscovery:16,distinctArtists:37,profiles:{bartek:{average:65,strong:17,weak:0},edyta:{average:67,strong:22,weak:0}},filters:{rawPool:2000,eligible:73,recognizability:833},stop:{remaining:25,artistLimitBlocked:18,duplicateBlocked:2,baseBelow35:5},acquisition:{before:40,after:42,cachedPages:0,newSearches:12}},
 cloud:{state:'success',lastfm:{status:'success',artists:656,tracks:655,bytes:131061,written:true}}});
export async function loadGenerationApi(){
 const url=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
 const state=readFileSync(new URL('../../functions/api/state.js',import.meta.url),'utf8').replace('"../../artist-exclusions.js"',JSON.stringify(url(readFileSync(new URL('../../artist-exclusions.js',import.meta.url),'utf8'))));
 const code=readFileSync(new URL('../../functions/api/generations.js',import.meta.url),'utf8').replace("'./state.js'",JSON.stringify(url(state))).replace("'../../generation-log.js'",JSON.stringify(url(readFileSync(new URL('../../generation-log.js',import.meta.url),'utf8'))));
 return import(url(code));
}
