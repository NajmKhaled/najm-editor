import {createHash} from 'node:crypto';
import {existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {cacheKey,run} from '../pipeline/process.js';

export interface ReferenceFrameEvidence {clipId:string;timelineTime:number;sourceTime:number|null;mediaPath:string;status:'OBSERVED'|'UNAVAILABLE';mediaKey?:string;framePath?:string;reason?:string}

export function summarizeReferenceSpeech(selected:{trackIndex:number;transcript:any}){const phrases=(Array.isArray(selected.transcript?.phrases)?selected.transcript.phrases:[]).filter((row:any)=>Number.isFinite(Number(row.start))&&Number.isFinite(Number(row.end))&&typeof row.text==='string'&&row.text.trim());return {status:'INFERRED' as const,trackIndex:selected.trackIndex,phraseCount:phrases.length,examples:phrases.slice(0,40).map((row:any)=>({start:Number(row.start),end:Number(row.end),text:String(row.text).slice(0,240)})),reason:'Local Whisper found speech on this audio track; its editorial role is not verified.'}}

export function assertReferenceMediaUnchanged(frames:ReferenceFrameEvidence[]){for(const row of frames){if(row.status!=='OBSERVED')continue;if(!row.mediaKey||!existsSync(row.mediaPath)||cacheKey(row.mediaPath)!==row.mediaKey)throw Error('Reference media changed or went offline; Learn Timeline again')}}

/** Sample the actual source moment selected by each primary-track clip. No Premiere mutation or model call. */
export async function sampleReferenceMoments(snapshot:any,trackIndex:number,dir:string,extract=run,onProgress?:(completed:number,total:number)=>void,signal?:AbortSignal):Promise<ReferenceFrameEvidence[]>{
  const track=(snapshot.videoTracks||[]).find((row:any)=>row.index===trackIndex),clips=(track?.clips||[]).filter((clip:any)=>clip.mediaPath);
  mkdirSync(dir,{recursive:true});const rows:ReferenceFrameEvidence[]=new Array(clips.length);let next=0,completed=0;
  onProgress?.(0,clips.length);
  await Promise.all(Array.from({length:Math.min(2,clips.length)},async()=>{while(next<clips.length){if(signal?.aborted)throw Error('Reference learning cancelled');const index=next++,clip=clips[index],sourceTime=(Number(clip.sourceIn)+Number(clip.sourceOut))/2,timelineTime=(Number(clip.start)+Number(clip.end))/2,mediaPath=String(clip.mediaPath),base={clipId:String(clip.id),timelineTime,sourceTime:Number.isFinite(sourceTime)?sourceTime:null,mediaPath};
    if(!Number.isFinite(clip.sourceIn)||!Number.isFinite(clip.sourceOut)||clip.sourceOut<=clip.sourceIn){rows[index]={...base,status:'UNAVAILABLE',reason:'Source in/out is unavailable'};onProgress?.(++completed,clips.length);continue}
    if(!existsSync(mediaPath)){rows[index]={...base,status:'UNAVAILABLE',reason:'Source media is offline'};onProgress?.(++completed,clips.length);continue}
    try{const mediaKey=cacheKey(mediaPath),key=createHash('sha256').update(JSON.stringify([mediaKey,sourceTime])).digest('hex'),path=join(dir,key+'.jpg');if(!existsSync(path))await extract('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(sourceTime),'-i',mediaPath,'-frames:v','1','-vf','scale=480:-2','-q:v','5','-y',path],signal,30000);if(!existsSync(path))throw Error('No frame returned');rows[index]={...base,status:'OBSERVED',mediaKey,framePath:path}}catch(error){if(signal?.aborted)throw Error('Reference learning cancelled');rows[index]={...base,status:'UNAVAILABLE',reason:String(error).slice(0,160)}}
    onProgress?.(++completed,clips.length);
  }}));return rows;
}
