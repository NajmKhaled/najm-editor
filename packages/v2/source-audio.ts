import type {VisualPlan} from './workflow-types.js';

export interface SourceAudioPlacement {id:string;mediaPath:string;trackIndex:number;start:number;end:number;sourceIn:number;sourceOut:number;origin:'clip'|'supporting'}
const pathKey=(value:string)=>value.replace(/\//g,'\\').toLowerCase();

/** Retain sound in source coordinates, then move it with the selected picture/story. A1 is reserved for narration. */
export function planSourceAudio(snapshot:any,plan:VisualPlan,narrationTrack:number,mapping:any[],embeddedAudioPaths:string[]):SourceAudioPlacement[]{
  const out:SourceAudioPlacement[]=[],embedded=new Set(embeddedAudioPaths.map(pathKey));
  const videoClips=(snapshot.videoTracks||[]).flatMap((t:any)=>t.clips||[]);
  const videoPaths=new Set<string>(videoClips.filter((c:any)=>c.mediaPath).map((c:any)=>pathKey(c.mediaPath)));
  const tracks=snapshot.audioTracks||[];
  const add=(row:Omit<SourceAudioPlacement,'id'>)=>{if(!Number.isSafeInteger(row.trackIndex)||row.trackIndex<1||!['start','end','sourceIn','sourceOut'].every(k=>Number.isFinite(row[k as keyof typeof row]))||row.start<0||row.sourceIn<0||Math.abs((row.end-row.start)-(row.sourceOut-row.sourceIn))>.08)throw Error('Invalid source audio mapping');if(row.end-row.start>1/120)out.push({id:'source_audio_'+(out.length+1),...row})};
  for(const shot of plan.shots){
    // Prefer the timeline's paired sound, using same-file camera audio and its source offsets.
    const sourceVideo=videoClips.find((c:any)=>c.mediaPath&&pathKey(c.mediaPath)===pathKey(shot.source_media)&&c.sourceIn<=shot.source_in+.01&&c.sourceOut>=shot.source_out-.01);
    let paired=false;
    if(sourceVideo){
      const speed=(sourceVideo.sourceOut-sourceVideo.sourceIn)/(sourceVideo.end-sourceVideo.start);
      if(Math.abs(speed-1)>.01)throw Error('Source sound requires an explicit speed mapping: '+shot.shot_id);
      const from=sourceVideo.start+shot.source_in-sourceVideo.sourceIn,to=from+shot.source_out-shot.source_in;
      for(const track of tracks)for(const c of track.clips||[]){
        if(!c.mediaPath||!videoPaths.has(pathKey(c.mediaPath)))continue;
        if(pathKey(c.mediaPath)!==pathKey(shot.source_media))continue;
        const start=Math.max(from,c.start),end=Math.min(to,c.end);if(end<=start)continue;
        if(Math.abs((c.sourceOut-c.sourceIn)-(c.end-c.start))>.08)throw Error('Source audio speed change is unsupported: '+c.name);
        paired=true;add({mediaPath:c.mediaPath,trackIndex:1+Number(track.index),start:shot.timeline_start+start-from,end:shot.timeline_start+end-from,sourceIn:c.sourceIn+start-c.start,sourceOut:c.sourceIn+end-c.start,origin:'clip'});
      }
    }
    // Footage selected outside the original assembly still keeps its embedded sound.
    if(!paired&&embedded.has(pathKey(shot.source_media)))add({mediaPath:shot.source_media,trackIndex:1+tracks.length,start:shot.timeline_start,end:shot.timeline_end,sourceIn:shot.source_in,sourceOut:shot.source_out,origin:'clip'});
  }
  // Music/ambience not paired with picture follows the kept story intervals.
  for(const track of tracks){if(Number(track.index)===narrationTrack)continue;for(const c of track.clips||[]){
    if(!c.mediaPath||videoPaths.has(pathKey(c.mediaPath)))continue;
    if(Math.abs((c.sourceOut-c.sourceIn)-(c.end-c.start))>.08)throw Error('Supporting audio speed change is unsupported: '+c.name);
    for(const m of mapping){const start=Math.max(c.start,m.sourceStart),end=Math.min(c.end,m.sourceEnd);if(end<=start)continue;add({mediaPath:c.mediaPath,trackIndex:1+Number(track.index),start:m.cleanStart+start-m.sourceStart,end:m.cleanStart+end-m.sourceStart,sourceIn:c.sourceIn+start-c.start,sourceOut:c.sourceIn+end-c.start,origin:'supporting'})}
  }}
  // Reordering picture can overlap a supporting bed formerly on the same track.
  // Assign a free track rather than letting overwriteClip trim either sound.
  const occupied=new Map<number,SourceAudioPlacement[]>();
  for(const row of out){while((occupied.get(row.trackIndex)||[]).some(x=>row.start<x.end-.005&&row.end>x.start+.005))row.trackIndex++;const clips=occupied.get(row.trackIndex)||[];clips.push(row);occupied.set(row.trackIndex,clips)}
  return out;
}

export function validateSourceAudio(snapshot:any,placements:SourceAudioPlacement[]){
  const tracks=(snapshot.audioTracks||[]).filter((t:any)=>Number(t.index)>0);
  const actual=tracks.flatMap((t:any)=>(t.clips||[]).map((c:any)=>({...c,trackIndex:Number(t.index)})));
  if(actual.length!==placements.length)throw Error('Source audio clip count differs: '+actual.length+'/'+placements.length);
  for(const p of placements){const index=actual.findIndex((c:any)=>c.trackIndex===p.trackIndex&&pathKey(c.mediaPath||'')===pathKey(p.mediaPath)&&(['start','end','sourceIn','sourceOut'] as const).every(k=>Math.abs(c[k]-p[k])<.08));if(index<0)throw Error('Source audio missing or out of sync: '+p.id);actual.splice(index,1)}
  return {preservedSourceClips:placements.length};
}

/** Caption mode may append graphics tracks, but every pre-existing clip stays identical. */
export function validatePreservedTimeline(before:any,after:any,clone=false){
  const stable=(clips:any[])=>JSON.stringify(clips.map(c=>clone?Object.fromEntries(Object.entries(c).filter(([k])=>k!=='id')):c));
  for(const key of ['videoTracks','audioTracks'])for(const track of before[key]||[]){
    const current=(after[key]||[]).find((t:any)=>Number(t.index)===Number(track.index));
    if(!current||current.muted!==track.muted||stable(current.clips)!==stable(track.clips))throw Error('Captions-only mode changed existing '+key+' track '+track.index);
  }
  return {existingClipsUnchanged:true};
}
