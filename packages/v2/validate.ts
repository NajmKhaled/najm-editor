import {validateSourceAudio,type SourceAudioPlacement} from './source-audio.js';
import {existsSync} from 'node:fs';
import {basename} from 'node:path';
import type {StoryPlan,VisualPlan} from './workflow-types.js';

function close(a:number,b:number,tolerance=1/30+.015){return Math.abs(a-b)<=tolerance}
export function normalizeVisualPlan(plan:VisualPlan,media:any[],story:StoryPlan,cleanMapping:any[]):VisualPlan{
  const byPath=new Map(media.map(x=>[String(x.mediaPath).toLowerCase(),x]));
  const byName=new Map<string,any[]>();for(const item of media){const name=basename(String(item.mediaPath)).toLowerCase(),rows=byName.get(name)||[];rows.push(item);byName.set(name,rows)}
  const ids=new Set(story.keep_segments.map(x=>x.id));
  return {...plan,shots:plan.shots.map(shot=>{
    const exact=byPath.get(String(shot.source_media).toLowerCase());const candidates=exact?[exact]:byName.get(basename(String(shot.source_media)).toLowerCase())||[];
    if(candidates.length!==1)throw Error('Visual shot media cannot be resolved uniquely: '+shot.shot_id+' '+shot.source_media);
    let narrationId=shot.narration_segment_id;
    if(!ids.has(narrationId)){
      let best=-1,overlap=0;for(let i=0;i<cleanMapping.length;i++){const m=cleanMapping[i],amount=Math.max(0,Math.min(shot.timeline_end,m.cleanEnd)-Math.max(shot.timeline_start,m.cleanStart));if(amount>overlap){overlap=amount;best=i}}
      if(best<0||!story.keep_segments[best])throw Error('Visual shot has no verified narration segment: '+shot.shot_id);
      narrationId=story.keep_segments[best].id;
    }
    return {...shot,source_media:String(candidates[0].mediaPath),narration_segment_id:narrationId};
  })};
}
export function normalizeStoryPlan(plan:StoryPlan):StoryPlan{
  const dangling=plan.keep_segments.filter(s=>/(?:\.{3,}|…)\s*$/.test(s.corrected_text)&&s.corrected_text.trim().split(/\s+/).length<=8);
  if(!dangling.length)return plan;
  const excluded=new Set(dangling.map(s=>s.id)),keep_segments=plan.keep_segments.filter(s=>!excluded.has(s.id));
  return {...plan,corrected_transcript:keep_segments.map(s=>s.corrected_text).join(' '),keep_segments,remove_segments:[...plan.remove_segments,...dangling.map(s=>({source_start:s.source_start,source_end:s.source_end,text:s.corrected_text}))]};
}
export function validateStory(plan:StoryPlan,duration:number){
  if(!plan.keep_segments?.length)throw Error('Story cleanup selected no speech');
  const ids=new Set<string>();let last=-1;
  for(const s of plan.keep_segments){if(!s.id||ids.has(s.id)||!s.corrected_text.trim())throw Error('Invalid or duplicate keep segment');ids.add(s.id);if(!Number.isFinite(s.source_start)||!Number.isFinite(s.source_end)||s.source_start<0||s.source_end<=s.source_start||s.source_end>duration+.2)throw Error('Keep segment outside source audio: '+s.id);if(s.source_start<last-.04)throw Error('Keep segments overlap or are not chronological');last=s.source_end}
  for(const r of plan.remove_segments||[])if(r.source_start<0||r.source_end>duration+.2||r.source_end<=r.source_start)throw Error('Invalid removed segment');
}
export function validateVisual(plan:VisualPlan,duration:number,media:any[],story:StoryPlan){
  if(!plan.title_ar?.trim()||!plan.shots?.length)throw Error('Visual plan lacks title or shots');
  const paths=new Map(media.map(x=>[String(x.mediaPath).toLowerCase(),x]));const beats=new Set(story.story_beats.map(x=>x.id)),narration=new Set(story.keep_segments.map(x=>x.id));
  const errors:string[]=[];let cursor=0;for(const shot of plan.shots){const span=shot.timeline_end-shot.timeline_start,pause=!shot.spoken_text?.trim()&&span<=.75&&/(?:\u0648\u0642\u0641\u0629|\u0635\u0645\u062a|pause|silence)/i.test(shot.relevance_reason||'');if(!shot.shot_id||!beats.has(shot.story_beat_id)||!narration.has(shot.narration_segment_id)||!shot.spoken_text?.trim()&&!pause||!shot.visual_description?.trim()||!shot.relevance_reason?.trim())errors.push('Shot semantic fields are incomplete: '+shot.shot_id);if(!close(shot.timeline_start,cursor))errors.push('Visual plan has gap or overlap before '+shot.shot_id);if(shot.timeline_end<=shot.timeline_start)errors.push('Invalid shot timing: '+shot.shot_id);const source=paths.get(String(shot.source_media).toLowerCase());if(!source||!existsSync(source.mediaPath))errors.push('Shot source unavailable: '+shot.source_media);else{if(shot.source_in<0||shot.source_out>source.duration+.05||shot.source_out<=shot.source_in)errors.push('Shot source range invalid: '+shot.shot_id);if(!close(shot.source_out-shot.source_in,span,.08))errors.push('Shot source duration mismatch: '+shot.shot_id)}cursor=shot.timeline_end}
  if(!close(cursor,duration,.15))errors.push('Visual plan does not cover clean narration duration');if(errors.length)throw Error(errors.join('; '));
}
export function validateRough(snapshot:any,plan:VisualPlan,cleanPath:string,duration:number,sourceAudio:SourceAudioPlacement[]=[]){
  const video=snapshot.videoTracks?.[0]?.clips||[],audio=snapshot.audioTracks?.[0]?.clips||[];if(video.length!==plan.shots.length)throw Error(`Rough cut shot count ${video.length} != ${plan.shots.length}`);if(audio.length!==1||String(audio[0].mediaPath).toLowerCase()!==cleanPath.toLowerCase())throw Error('A1 must contain only verified clean narration');if(!close(audio[0].start,0)||!close(audio[0].end,duration,.15))throw Error('Clean narration duration mismatch');validateSourceAudio(snapshot,sourceAudio);for(let i=0;i<plan.shots.length;i++){const p=plan.shots[i],c=video[i];if(String(c.mediaPath).toLowerCase()!==p.source_media.toLowerCase()||!close(c.start,p.timeline_start,.08)||!close(c.end,p.timeline_end,.08)||!close(c.sourceIn,p.source_in,.08)||!close(c.sourceOut,p.source_out,.08))throw Error('Premiere shot readback mismatch: '+p.shot_id);if(i&&c.start-video[i-1].end>.09)throw Error('Major visual gap before '+p.shot_id)}return {expectedShots:plan.shots.length,actualShots:video.length,duration:audio[0].end};
}
export function validateGraphics(snapshot:any,captions:any[],title:any){
  const graphics=(snapshot.videoTracks||[]).flatMap((t:any)=>t.clips||[]).filter((c:any)=>c.graphic?.length);const expected=[...captions.map(c=>({...c,kind:'caption'})),{...title,kind:'title'}];for(const item of expected){const c=graphics.find((x:any)=>close(x.start,item.start)&&close(x.end,item.end,.08)&&x.graphic?.some((g:any)=>g.text===item.text));if(!c)throw Error(item.kind+' graphic missing or text/timing differs at '+item.start)}return {captionCount:captions.length,titleText:title.text};
}
export function sourceUnchanged(before:any,after:any){const stable=(x:any)=>JSON.stringify({id:x.id,name:x.name,duration:x.duration,width:x.width,height:x.height,sequenceFps:x.sequenceFps,videoTracks:x.videoTracks,audioTracks:x.audioTracks});if(stable(before)!==stable(after))throw Error('Source sequence changed during V2 build')}
