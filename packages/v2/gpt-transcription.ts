import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {probe,run} from '../pipeline/process.js';
import {cachedMediaHash,jsonFile,saveJson} from './media.js';

// This GPT transcription variant exposes real segment timestamps. Sol has no audio input.
export const TRANSCRIPTION_MODEL='gpt-4o-transcribe-diarize';
export interface TimedPhrase {id:string;start:number;end:number;text:string}
export interface GptTranscript {provider:'openai';model:typeof TRANSCRIPTION_MODEL;timingEvidence:'OBSERVED';raw_text:string;phrases:TimedPhrase[];words:never[]}
export const gptTranscriptionReady=()=>!!(process.env.NAJM_OPENAI_API_KEY||process.env.OPENAI_API_KEY);

export function parseGptTranscript(value:any,offset:number,duration:number):TimedPhrase[]{
  if(!Array.isArray(value?.segments))throw Error('GPT transcription did not return timestamped segments');
  let previous=0;
  return value.segments.map((s:any,i:number)=>{
    if(typeof s.text!=='string'||!s.text.trim()||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end>duration+.15||s.start<previous)throw Error('GPT returned invalid or overlapping speech timestamps at segment '+i);
    previous=s.end;return {id:'phrase_'+i,start:offset+s.start,end:offset+Math.min(s.end,duration),text:s.text.trim()};
  });
}

/** GPT only, no local ASR fallback. Upload short WAV chunks and keep provider timestamps. */
export async function transcribeWithGpt(audio:string,dir:string,signal?:AbortSignal,onProgress?:(done:number,total:number)=>void,request:typeof fetch=fetch):Promise<GptTranscript>{
  if(process.env.NAJM_AUDIO_API_CONSENT!=='upload-audio')throw Error('AUDIO_CONSENT_REQUIRED: review the audio upload and separate API billing in docs/PROVIDERS.md');
  const key=process.env.NAJM_OPENAI_API_KEY||process.env.OPENAI_API_KEY;
  if(!key)throw Error('GPT_TRANSCRIPTION_KEY_REQUIRED: Set OPENAI_API_KEY or NAJM_OPENAI_API_KEY for GPT transcription. ChatGPT/Codex login does not provide audio transcription. Whisper will not be used.');
  const hash=await cachedMediaHash(audio,dir),cache=join(dir,'gpt-transcript-'+createHash('sha256').update(TRANSCRIPTION_MODEL+'|v1|'+hash).digest('hex')+'.json');
  const prior=jsonFile<GptTranscript>(cache);
  if(prior?.provider==='openai'&&prior.model===TRANSCRIPTION_MODEL){try{parseGptTranscript({segments:prior.phrases},0,Infinity);return prior}catch{}}
  const info=await probe(audio,join(dir,'probe'),signal),duration=Number(info.format?.duration);if(!Number.isFinite(duration)||duration<=0)throw Error('GPT transcription audio duration is unavailable');
  mkdirSync(dir,{recursive:true});const phrases:TimedPhrase[]=[],chunkSeconds=300,total=Math.ceil(duration/chunkSeconds);
  for(let i=0;i<total;i++){
    signal?.throwIfAborted();onProgress?.(i,total);const start=i*chunkSeconds,span=Math.min(chunkSeconds,duration-start),path=join(dir,'gpt-audio-'+TRANSCRIPTION_MODEL+'-'+hash.slice(0,16)+'-'+i+'.wav');
    if(!existsSync(path))await run('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(start),'-t',String(span),'-i',audio,'-map','0:a:0','-ar','16000','-ac','1','-c:a','pcm_s16le','-y',path],signal,120000);
    const chunkCache=path+'.gpt.json';let value=jsonFile<any>(chunkCache);
    if(value){try{parseGptTranscript(value,start,span)}catch{value=undefined}}
    if(!value){
      const form=new FormData();form.set('file',new Blob([readFileSync(path)],{type:'audio/wav'}),basename(path));form.set('model',TRANSCRIPTION_MODEL);form.set('response_format','diarized_json');form.set('chunking_strategy','auto');
      const timeout=AbortSignal.timeout(300000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
      const response=await request('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:combined});
      if(!response.ok)throw Error('GPT transcription request failed (HTTP '+response.status+'). Check API key, model access and billing. Whisper will not be used.');
      value=await response.json();parseGptTranscript(value,start,span);saveJson(chunkCache,value);
    }
    phrases.push(...parseGptTranscript(value,start,span));onProgress?.(i+1,total);
  }
  const result:GptTranscript={provider:'openai',model:TRANSCRIPTION_MODEL,timingEvidence:'OBSERVED',raw_text:phrases.map(p=>p.text).join(' '),phrases:phrases.map((p,i)=>({...p,id:'phrase_'+i})),words:[]};
  writeFileSync(cache,JSON.stringify(result,null,2),'utf8');return result;
}

export interface CaptionReview {title_ar:string;phrases:{id:string;text:string;uncertain:boolean;note:string}[]}
/** Sol corrects wording using context; it cannot change timing or silently drop a phrase. */
export function reviewedCaptions(raw:GptTranscript,review:CaptionReview){
  if(!review?.title_ar?.trim()||review.title_ar.trim().split(/\s+/).length<2||!Array.isArray(review.phrases)||review.phrases.length!==raw.phrases.length)throw Error('Sol caption review omitted speech or a title');
  const ids=new Set<string>();
  const captions=raw.phrases.map(p=>{const r=review.phrases.find(x=>x.id===p.id);if(!r||ids.has(r.id)||typeof r.text!=='string'||!r.text.trim())throw Error('Sol caption review missing/duplicate phrase '+p.id);ids.add(r.id);return {start:p.start,end:p.end,text:r.text.trim()}});
  return {captions,title:{start:0,end:Math.min(2.5,Math.max(...raw.phrases.map(p=>p.end))),text:review.title_ar.trim()},reviewRequired:review.phrases.filter(p=>p.uncertain)};
}
