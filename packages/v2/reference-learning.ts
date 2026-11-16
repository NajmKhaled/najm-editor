import {createHash} from 'node:crypto';

export interface ApprovedReferencePreference {
  targetShotDurationMs:number;
  evidence:{sourceFingerprint:string;observedMedianMs:number;shotCount:number;method:'primary-video-track-median'};
  styleMemory?:ReferenceStyleMemory;
}

/** Structural style measured from a Premiere Direct snapshot; no story or visual semantics are inferred. */
export interface ReferenceStyleMemory {
  schemaVersion:1;
  status:'DERIVED';
  pacing:{lowerQuartileMs:number;upperQuartileMs:number;openingFiveSecondsMedianMs:number|null};
  picture:{overlayMediaClips:number;graphicLikeClips:number;graphicLikeMedianMs:number|null;graphicLikeTracks:number[];effectComponentClips:number};
  sound:{trackCount:number;clipCount:number};
  continuity:{cuts:number;gaps:number;overlaps:number;reusedPlacements:number};
}

const round=(value:number)=>Math.round(value*1000);
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
const duration=(clip:any)=>Number(clip.end)-Number(clip.start);
const validClips=(track:any)=>Array.isArray(track?.clips)?track.clips.filter((clip:any)=>finite(clip.start)&&finite(clip.end)&&duration(clip)>0):[];
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?Math.round((sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2):0};
const quantile=(values:number[],fraction:number)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*fraction)]};
const words=(text:string)=>text.trim().split(/\s+/).filter(Boolean).length;
type SnapshotClip={start:number;end:number;name?:string;mediaPath?:string;projectItemId?:string;graphic?:Array<{property?:string;text?:string}>;componentNames?:string[]};
type SnapshotTrack={index:number;clips:SnapshotClip[]};

/** Pure analysis of the existing read-only Direct snapshot. No project mutations or model calls. */
export function analyzeReferenceSnapshot(snapshot:any,projectPath:string,assets:{caption:boolean;title:boolean}){
  if(!snapshot||typeof snapshot.id!=='string'||!snapshot.id||!finite(snapshot.duration)||snapshot.duration<=0)throw Error('Reference sequence identity or duration is unavailable');
  const video:SnapshotTrack[]=(Array.isArray(snapshot.videoTracks)?snapshot.videoTracks:[]).map((track:any)=>({index:Number(track.index),clips:validClips(track)}));
  const audio:SnapshotTrack[]=(Array.isArray(snapshot.audioTracks)?snapshot.audioTracks:[]).map((track:any)=>({index:Number(track.index),clips:validClips(track)}));
  const primary=[...video].sort((a,b)=>{
    const coverage=(track:{clips:any[]})=>track.clips.filter(c=>c.mediaPath).reduce((n,c)=>n+duration(c),0);
    return coverage(b)-coverage(a)||a.index-b.index;
  })[0];
  const shots=(primary?.clips||[]).filter(c=>c.mediaPath).sort((a,b)=>a.start-b.start||a.end-b.end);
  const durations=shots.map(c=>round(duration(c))),gaps:number[]=[],overlaps:number[]=[];let cuts=0;
  for(let i=1;i<shots.length;i++){const delta=Number(shots[i].start)-Number(shots[i-1].end);if(delta>.05)gaps.push(round(delta));else if(delta<-.05)overlaps.push(round(-delta));else cuts++}
  const sourceCounts=new Map<string,number>();for(const clip of shots){const identity=String(clip.projectItemId||clip.mediaPath).toLowerCase();sourceCounts.set(identity,(sourceCounts.get(identity)||0)+1)}
  const graphics=video.flatMap(track=>track.clips.filter(c=>Array.isArray(c.graphic)&&c.graphic.length).map(c=>({track:track.index,start:c.start,end:c.end,properties:(c.graphic||[]).filter((p:any)=>typeof p.text==='string'&&p.text.trim()).map((p:any)=>({property:String(p.property||''),text:p.text.slice(0,160)}))}))).filter(c=>c.properties.length);
  const graphicLike=video.flatMap(track=>track.clips.filter(c=>!c.mediaPath&&String((c as any).name||'')==='Graphic').map(c=>({track:track.index,start:c.start,end:c.end})));
  const intrinsic=new Set(['Motion','Opacity','Time Remapping','Volume','Panner','Channel Volume']);
  const effectCandidates=video.concat(audio).flatMap(track=>track.clips.filter(c=>Array.isArray(c.componentNames)&&c.componentNames.some(name=>!intrinsic.has(name))).map(c=>({track:track.index,names:c.componentNames!.filter(name=>!intrinsic.has(name))})));
  const effectNames=[...new Set(effectCandidates.flatMap(c=>c.names))].sort().slice(0,20);
  const componentEvidence=video.concat(audio).flatMap(track=>track.clips.flatMap((clip:any)=>(clip.components||[]).filter((component:any)=>component&&typeof component.matchName==='string'&&component.matchName).map((component:any)=>({track:track.index,clip:clip.name||'',name:component.name||'',matchName:component.matchName,properties:(component.properties||[]).filter((property:any)=>property&&typeof property.name==='string').map((property:any)=>({name:property.name,...(Object.hasOwn(property,'value')?{value:property.value}:{}),...(Number.isInteger(property.keyframeCount)?{keyframeCount:property.keyframeCount}:{})})).slice(0,32)})))).slice(0,100);
  const captionCandidates=graphics.filter(c=>duration(c)<=5),captionWords=captionCandidates.map(c=>words(c.properties[0].text));
  const fingerprint=createHash('sha256').update(JSON.stringify([projectPath,snapshot.id,snapshot.name,snapshot.duration,snapshot.sequenceFps,snapshot.width,snapshot.height,snapshot.videoTracks,snapshot.audioTracks])).digest('hex');
  const observed={sequence:{id:snapshot.id,name:String(snapshot.name||''),durationSeconds:snapshot.duration,fps:finite(snapshot.sequenceFps)?snapshot.sequenceFps:null,width:finite(snapshot.width)?snapshot.width:null,videoTrackCount:video.length,audioTrackCount:audio.length},primaryVideoTrack:primary?.index??null,shotCount:shots.length,shotDurationMs:{min:durations.length?durations.reduce((a,b)=>Math.min(a,b)):null,median:durations.length?median(durations):null,max:durations.length?durations.reduce((a,b)=>Math.max(a,b)):null},cuts,gapCount:gaps.length,gapDurationMs:gaps,overlapCount:overlaps.length,layeredClipCount:video.filter(x=>x!==primary).reduce((n,x)=>n+x.clips.length,0),sourceReuse:{distinctSources:sourceCounts.size,repeatedSources:[...sourceCounts.values()].filter(n=>n>1).length,reusedClipPlacements:[...sourceCounts.values()].reduce((n,c)=>n+Math.max(0,c-1),0)},audioTracks:audio.map(track=>({index:track.index,clipCount:track.clips.length,occupiedMs:track.clips.reduce((n,c)=>n+round(duration(c)),0)})),graphicText:{clipCount:graphics.length,readableProperties:[...new Set(graphics.flatMap(c=>c.properties.map((p:any)=>p.property)))],samples:graphics.slice(0,5).map(c=>({track:c.track,start:c.start,end:c.end,text:c.properties[0].text}))},effectComponents:{status:effectNames.length?'INFERRED':'UNAVAILABLE',clipCount:effectCandidates.length,names:effectNames}};
  const proposed=durations.length>=3?{targetShotDurationMs:Math.max(500,Math.min(10000,median(durations))),status:'DERIVED' as const,confidence:durations.length>=8?'medium':'low',reason:'Median duration of media clips on the primary video track. Review before approval.'}:null;
  const opening=shots.filter(c=>c.start<5).map(c=>round(Math.min(c.end,5)-c.start)).filter(x=>x>0);
  const styleMemory:ReferenceStyleMemory|null=durations.length>=3?{schemaVersion:1,status:'DERIVED',pacing:{lowerQuartileMs:quantile(durations,.25),upperQuartileMs:quantile(durations,.75),openingFiveSecondsMedianMs:opening.length?median(opening):null},picture:{overlayMediaClips:video.filter(x=>x!==primary).reduce((n,x)=>n+x.clips.filter(c=>!!c.mediaPath).length,0),graphicLikeClips:graphicLike.length,graphicLikeMedianMs:graphicLike.length?median(graphicLike.map(c=>round(duration(c)))):null,graphicLikeTracks:[...new Set(graphicLike.map(c=>c.track))].sort((a,b)=>a-b),effectComponentClips:effectCandidates.length},sound:{trackCount:audio.length,clipCount:audio.reduce((n,x)=>n+x.clips.length,0)},continuity:{cuts,gaps:gaps.length,overlaps:overlaps.length,reusedPlacements:[...sourceCounts.values()].reduce((n,c)=>n+Math.max(0,c-1),0)}}:null;
  const unsupported=[
    {property:'Narration identity',status:'UNAVAILABLE',reason:'Snapshot exposes audio clips and tracks, not a verified narration role.'},
    {property:'Caption or title role',status:'INFERRED',reason:'Readable short graphic clips may be captions; their role is not verified.'},
    {property:'Reference MOGRT identity and transfer',status:'UNAVAILABLE',reason:'Snapshot does not expose a verified source template identity.'},
    {property:'Fonts, transforms, effect settings and animations',status:'UNAVAILABLE',reason:'Direct may expose component names, but it does not verify these visual settings.'},
    {property:'Storytelling intent',status:'UNAVAILABLE',reason:'Clip timing alone cannot establish narrative intent.'}
  ];
  return {schemaVersion:1,sourceFingerprint:fingerprint,observedAt:new Date().toISOString(),observed,componentEvidence,proposed,styleMemory,captionPattern:{status:captionCandidates.length>=3?'INFERRED':'UNAVAILABLE',candidateCount:captionCandidates.length,medianWords:captionWords.length?median(captionWords):null,medianDurationMs:captionCandidates.length?median(captionCandidates.map(c=>round(duration(c)))):null},supported:{shotPacing:'Confirmed shot target enters visual candidate planning; result is measured after TEST',graphicText:'Read-only inspection; packaged caption/title templates use text and timing substitution'},dependencies:{captionTemplate:assets.caption?'available':'missing',titleTemplate:assets.title?'available':'missing',referenceTemplate:'unavailable'},unsupported};
}

export function approvedReferencePreference(value:unknown):ApprovedReferencePreference {
  const x=value as any;
  if(!x||typeof x!=='object'||Array.isArray(x)||!['evidence,targetShotDurationMs','evidence,styleMemory,targetShotDurationMs'].includes(Object.keys(x).sort().join(','))||!Number.isInteger(x.targetShotDurationMs)||x.targetShotDurationMs<500||x.targetShotDurationMs>10000)throw Error('Target shot duration must be 500 to 10000 milliseconds');
  const e=x.evidence;
  if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).sort().join(',')!=='method,observedMedianMs,shotCount,sourceFingerprint'||typeof e.sourceFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(e.sourceFingerprint)||!Number.isInteger(e.observedMedianMs)||e.observedMedianMs<1||!Number.isInteger(e.shotCount)||e.shotCount<3||e.method!=='primary-video-track-median')throw Error('Reference evidence is invalid');
  if(x.styleMemory!==undefined){const s=x.styleMemory,validCount=(n:any)=>Number.isSafeInteger(n)&&n>=0&&n<=100000,validMs=(n:any)=>validCount(n)&&n>0,keys=(o:any,k:string)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===k;if(!keys(s,'continuity,pacing,picture,schemaVersion,sound,status')||s.schemaVersion!==1||s.status!=='DERIVED'||!keys(s.pacing,'lowerQuartileMs,openingFiveSecondsMedianMs,upperQuartileMs')||!validMs(s.pacing.lowerQuartileMs)||!validMs(s.pacing.upperQuartileMs)||s.pacing.upperQuartileMs<s.pacing.lowerQuartileMs||s.pacing.openingFiveSecondsMedianMs!==null&&!validMs(s.pacing.openingFiveSecondsMedianMs)||!keys(s.picture,'effectComponentClips,graphicLikeClips,graphicLikeMedianMs,graphicLikeTracks,overlayMediaClips')||!validCount(s.picture.overlayMediaClips)||!validCount(s.picture.graphicLikeClips)||!validCount(s.picture.effectComponentClips)||s.picture.graphicLikeMedianMs!==null&&!validMs(s.picture.graphicLikeMedianMs)||!Array.isArray(s.picture.graphicLikeTracks)||s.picture.graphicLikeTracks.length>128||s.picture.graphicLikeTracks.some((n:any)=>!validCount(n)||n>127)||!keys(s.sound,'clipCount,trackCount')||!validCount(s.sound.trackCount)||!validCount(s.sound.clipCount)||!keys(s.continuity,'cuts,gaps,overlaps,reusedPlacements')||['cuts','gaps','overlaps','reusedPlacements'].some(k=>!validCount(s.continuity[k])))throw Error('Reference style memory is invalid')}
  return x as ApprovedReferencePreference;
}
