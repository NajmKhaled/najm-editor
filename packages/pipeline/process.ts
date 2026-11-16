import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {assertNoBarePython,getWhisperModel,isModelCached,resolvePythonRuntime,runPython} from './python-runtime.js';
export function run(binary:string,args:string[],signal?:AbortSignal,timeoutMs=600000):Promise<string>{assertNoBarePython(binary,'pipeline.process.run');if(/(?:^|[\\/])(?:python|py)(?:\.exe)?$/i.test(binary))throw Error('PYTHON_LAUNCHER_REQUIRED: '+binary);return new Promise((yes,no)=>{let out='',err='';const p=spawn(binary,args,{windowsHide:true,signal});const timer=setTimeout(()=>p.kill(),timeoutMs);p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');p.stdout.on('data',s=>out+=s);p.stderr.on('data',s=>err+=s);p.on('error',no);p.on('close',c=>{clearTimeout(timer);c===0?yes(out):no(Error(binary+' exited '+c+': '+err.slice(-1200)))});});}
export interface MediaOperation {operation:string;mediaPath:string;pid?:number;startedAt:number;lastHeartbeatAt:number;elapsedMs:number;status:'RUNNING'|'COMPLETED'|'FAILED'|'TIMEOUT'|'ABORTED';error?:string}
export type MediaOperationObserver=(state:MediaOperation)=>void;
export function runMediaOperation(binary:string,args:string[],mediaPath:string,operation:string,signal?:AbortSignal,timeoutMs=120000,onState?:MediaOperationObserver):Promise<string>{assertNoBarePython(binary,'pipeline.runMediaOperation');const startedAt=Date.now();return new Promise((resolve,reject)=>{let out='',err='',settled=false,timedOut=false,lastActivityAt=startedAt;const child=spawn(binary,args,{windowsHide:true,signal});const publish=(status:MediaOperation['status'],error?:string)=>onState?.({operation,mediaPath,pid:child.pid,startedAt,lastHeartbeatAt:lastActivityAt,elapsedMs:Date.now()-startedAt,status,error});publish('RUNNING');const heartbeat=setInterval(()=>publish('RUNNING'),1000);const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',x=>{out+=x;lastActivityAt=Date.now();publish('RUNNING')});child.stderr.on('data',x=>{err+=x;lastActivityAt=Date.now();publish('RUNNING')});const finish=(status:MediaOperation['status'],error?:Error)=>{if(settled)return;settled=true;clearInterval(heartbeat);clearTimeout(timer);publish(status,error?.message);if(error)reject(error);else resolve(out+err)};child.on('error',e=>finish('FAILED',e));child.on('close',code=>{if(timedOut)finish('TIMEOUT',Error(operation+' timed out after '+timeoutMs+' ms'));else if(signal?.aborted)finish('ABORTED',Error(operation+' aborted'));else if(code!==0)finish('FAILED',Error(operation+' failed (exit '+code+'): '+err.slice(-500)));else finish('COMPLETED')});});}
export function cacheKey(path:string){const p=resolve(path),s=statSync(p);return createHash('sha256').update(p+'|'+s.size+'|'+s.mtimeMs).digest('hex')}
export async function probe(path:string,cacheDir:string,signal?:AbortSignal,onOperation?:MediaOperationObserver,execute=runMediaOperation):Promise<any>{mkdirSync(cacheDir,{recursive:true});const key=cacheKey(path),file=join(cacheDir,key+'.probe.json');if(existsSync(file))try{const cached=JSON.parse(readFileSync(file,'utf8'));if(Array.isArray(cached.streams)&&cached.format)return cached}catch{}const data=JSON.parse(await execute('ffprobe',['-v','error','-show_format','-show_streams','-of','json',path],path,'metadata probe',signal,60000,onOperation));if(!Array.isArray(data.streams)||!data.format)throw Error('FFprobe returned incomplete media metadata');writeFileSync(file,JSON.stringify(data));return data;}
export async function extractAudio(path:string,sourceIn:number,sourceOut:number,out:string,signal?:AbortSignal){
  if(sourceOut<=sourceIn)throw Error('Invalid narration source range');
  mkdirSync(dirname(out),{recursive:true});
  if(!existsSync(out))await run('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(sourceIn),'-i',path,'-t',String(sourceOut-sourceIn),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le','-y',out],signal,3600000);
  return out;
}
export async function frames(path:string,duration:number,cacheDir:string,signal?:AbortSignal){const key=cacheKey(path),dir=join(cacheDir,key);mkdirSync(dir,{recursive:true});const samples=[0.15,0.5,0.85].map(x=>Math.max(0.05,Math.min(duration-0.05,duration*x)));const files:string[]=[];for(let i=0;i<samples.length;i++){const f=join(dir,i+'.jpg');if(!existsSync(f))await run('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(samples[i]),'-i',path,'-frames:v','1','-vf','scale=480:-2','-y',f],signal,60000);files.push(f)}return files;}
export async function transcribe(path:string,out:string,model=getWhisperModel(),signal?:AbortSignal){const runtime=await resolvePythonRuntime();if(runtime.source==='unavailable')throw Error('Python/Whisper is unavailable: '+runtime.error);if(!isModelCached(model))throw Error('Whisper model '+model+' is not cached locally. Choose a cached model in Settings before Analyze; Najm will not download it silently.');if(!existsSync(out))await runPython(['tools/transcribe_new_project.py',path,out,'--model',model,'--preprocessed'],{signal,timeoutMs:3600000});return JSON.parse(readFileSync(out,'utf8'));}
const instruction=/^(\u0627\u0628\u062f\u0623|\u0639\u064a\u062f|\u0623\u0639\u062f|\u0648\u0642\u0641|\u0633\u062a\u0648\u0628|\u0642\u0635|\u0627\u062d\u0630\u0641|\u062e\u0644\u064a|\u062e\u0630|\u0645\u0631\u0629 \u062b\u0627\u0646\u064a\u0629|\u0644\u0627 \u0644\u0627)/;
export function selectNarration(transcript:any,sourcePath:string){const phrases:any[]=transcript.phrases||[];const selected:any[]=[];const rejected:any[]=[];for(let i=0;i<phrases.length;i++){const p=phrases[i],text=String(p.text||'').trim(),next=phrases[i+1];const duplicate=next&&normalize(text)===normalize(String(next.text||''));const lowConfidence=Number(p.no_speech_prob||0)>0.75||Number(p.avg_logprob||0)<-1.5;if(!text||instruction.test(text)||duplicate||lowConfidence){rejected.push({source:sourcePath,text,start:p.start,end:p.end,reason:duplicate?'repeated take':lowConfidence?'low-confidence speech':'likely editor instruction or empty'});continue}selected.push({source:sourcePath,start:Math.max(0,p.start-0.08),end:p.end+0.12,text,words:(transcript.words||[]).filter((w:any)=>Number(w.start)>=Number(p.start)-.05&&Number(w.end)<=Number(p.end)+.05),reason:'usable phrase; heuristic selection'});}if(!selected.length)throw Error('No usable narration phrases detected; review transcript manually');return {selected,rejected,reviewRequired:rejected.length>0};}
function normalize(s:string){return s.replace(/[\p{P}\p{M}\s]/gu,'').toLowerCase()}
 export async function cleanNarration(plan:any,out:string,crossfadeMs:number,signal?:AbortSignal){const ranges=plan.selected;const args=['-hide_banner','-loglevel','error'];for(const r of ranges)args.push('-ss',String(r.start),'-to',String(r.end),'-i',r.source);const filters:string[]=[];ranges.forEach((_:any,i:number)=>filters.push('['+i+':a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a'+i+']'));let output='a0',elapsed=0;const mapping:any[]=[];for(let i=0;i<ranges.length;i++){const r=ranges[i],d=r.end-r.start,fade=i?Math.min(crossfadeMs/1000,d/4,(ranges[i-1].end-ranges[i-1].start)/4):0;const cleanStart=elapsed-fade;const words=(r.words||[]).map((w:any)=>({...w,cleanStart:cleanStart+Number(w.start)-r.start,cleanEnd:cleanStart+Number(w.end)-r.start})).filter((w:any)=>Number.isFinite(w.cleanStart)&&Number.isFinite(w.cleanEnd)&&w.cleanEnd>w.cleanStart);mapping.push({cleanStart,cleanEnd:cleanStart+d,source:r.source,sourceStart:r.start,sourceEnd:r.end,text:r.text,words});elapsed+=d-fade;if(i){const target='x'+i;filters.push('['+output+'][a'+i+']acrossfade=d='+fade.toFixed(3)+':c1=qsin:c2=qsin['+target+']');output=target;}}
  await run('ffmpeg',[...args,'-filter_complex',filters.join(';'),'-map','['+output+']','-c:a','pcm_s24le','-y',out],signal,3600000);for(let i=0;i<mapping.length;i++){const range=ranges[i],m=mapping[i];m.words=(range.words||[]).map((w:any)=>({...w,cleanStart:m.cleanStart+Math.max(0,Number(w.start)-range.start),cleanEnd:m.cleanStart+Math.max(0,Number(w.end)-range.start)}));}return {path:out,duration:elapsed,mapping};}
export function mediaDescriptor(path:string,probeData:any,framePaths:string[]){const v=(probeData.streams||[]).find((x:any)=>x.codec_type==='video');const width=Number(v?.width||0),height=Number(v?.height||0);return {mediaPath:path,name:basename(path),folderHint:basename(dirname(path)),duration:Number(probeData.format?.duration||v?.duration||0),width,height,fps:v?.avg_frame_rate,orientation:height>width?'portrait':width>height?'landscape':'square',frames:framePaths,filenameHint:basename(path),description:'Visual content not yet verified; filename is only a hint',role:'CONTEXT',confidence:0};}

export async function candidateFrames(path:string,sourceIn:number,sourceOut:number,cacheDir:string,still=false,signal?:AbortSignal){
  const key=cacheKey(path)+'-'+Math.round(sourceIn*1000)+'-'+Math.round(sourceOut*1000),dir=join(cacheDir,key);mkdirSync(dir,{recursive:true});
  const times=still?[0]:[0.15,0.5,0.85].map(f=>sourceIn+(sourceOut-sourceIn)*f);
  const files:string[]=[];
  for(let i=0;i<times.length;i++){const file=join(dir,i+'.jpg');if(!existsSync(file))await run('ffmpeg',['-hide_banner','-loglevel','error',...(still?[]:['-ss',String(times[i])]),'-i',path,'-frames:v','1','-vf','scale=480:-2','-y',file],signal,60000);files.push(file)}
  return files;
}
export async function contactSheet(framePaths:string[],out:string,signal?:AbortSignal){
  if(existsSync(out))return out;
  if(framePaths.length===1){await run('ffmpeg',['-hide_banner','-loglevel','error','-i',framePaths[0],'-frames:v','1','-y',out],signal,60000);return out}
  const inputs=framePaths.flatMap(path=>['-i',path]);const stack=framePaths.map((_,i)=>`[${i}:v]`).join('')+`hstack=inputs=${framePaths.length}`;
  await run('ffmpeg',['-hide_banner','-loglevel','error',...inputs,'-filter_complex',stack,'-frames:v','1','-y',out],signal,60000);return out;
}

export async function sceneCuts(path:string,sourceIn:number,sourceOut:number,cacheDir:string,signal?:AbortSignal,onOperation?:MediaOperationObserver,execute=runMediaOperation):Promise<number[]>{
  if(!Number.isFinite(sourceIn)||!Number.isFinite(sourceOut)||sourceIn<0||sourceOut<=sourceIn)throw Error('Invalid scene detection range');
  mkdirSync(cacheDir,{recursive:true});
  const key=cacheKey(path)+'-'+Math.round(sourceIn*1000)+'-'+Math.round(sourceOut*1000),file=join(cacheDir,key+'.scenes-v3.json');
  const cached=()=>{try{const result=JSON.parse(readFileSync(file,'utf8'));return result?.version===3&&Array.isArray(result.cuts)&&result.cuts.every((x:unknown)=>typeof x==='number'&&Number.isFinite(x))?result.cuts as number[]:undefined}catch{return undefined}};
  const existing=cached();if(existing)return existing;
  const chunks:any[]=[],cuts:number[]=[],chunkSeconds=20;
  for(let cursor=sourceIn,index=0;cursor<sourceOut-1e-7;cursor+=chunkSeconds,index++){
    if(signal?.aborted)throw Error('scene detection aborted');
    const centralEnd=Math.min(sourceOut,cursor+chunkSeconds),analysisStart=Math.max(sourceIn,cursor-.5),analysisEnd=Math.min(sourceOut,centralEnd+.5),part=join(cacheDir,key+'.scene-part-'+index+'.json');
    let row:any;try{const value=JSON.parse(readFileSync(part,'utf8'));if(value?.version===3&&value.cursor===cursor&&value.centralEnd===centralEnd&&Array.isArray(value.cuts)&&value.cuts.every((x:unknown)=>typeof x==='number'&&Number.isFinite(x)))row=value}catch{}
    if(!row){
      const common=['-hide_banner','-loglevel','info','-nostats','-progress','pipe:2','-ss',String(analysisStart),'-i',path,'-t',String(analysisEnd-analysisStart),'-map','0:v:0','-vf','fps=12,scale=320:-2,scdet=threshold=12,metadata=print:key=lavfi.scd.time','-fps_mode','vfr','-an','-f','null','-'];
      let output='',method='sampled-full-decode',warning:string|undefined;
      try{output=await execute('ffmpeg',common,path,'scene detection',signal,30000,onOperation)}
      catch(error){if(signal?.aborted)throw error;warning=String(error);method='keyframe-fallback';try{output=await execute('ffmpeg',['-hide_banner','-loglevel','info','-nostats','-progress','pipe:2','-skip_frame','nokey','-ss',String(analysisStart),'-i',path,'-t',String(analysisEnd-analysisStart),'-map','0:v:0','-vf','scale=320:-2,scdet=threshold=12,metadata=print:key=lavfi.scd.time','-fps_mode','vfr','-an','-f','null','-'],path,'scene detection keyframe fallback',signal,30000,onOperation)}catch(fallback){if(signal?.aborted)throw fallback;warning+='; '+String(fallback);method='unavailable'}}
      const found=[...output.matchAll(/lavfi\.scd\.time[=:]([\d.]+)/g)].map(m=>analysisStart+Number(m[1])).filter(x=>x>=cursor&&x<centralEnd&&x>sourceIn+.5&&x<sourceOut-.5);
      row={version:3,cursor,centralEnd,analysisStart,analysisEnd,method,warning,cuts:[...new Set(found.map(x=>Math.round(x*100)/100))].sort((a,b)=>a-b)};
      writeFileSync(part,JSON.stringify(row));
    }
    chunks.push({start:cursor,end:centralEnd,method:row.method,warning:row.warning||null});cuts.push(...row.cuts);
  }
  const unique=[...new Set(cuts)].sort((a,b)=>a-b);writeFileSync(file,JSON.stringify({version:3,sourceIn,sourceOut,method:'chunked 12 fps 320px scene detection with keyframe fallback',cuts:unique,chunks}));return unique;
}

export async function candidateQuality(path:string,sourceIn:number,sourceOut:number,cacheDir:string,still=false,signal?:AbortSignal,onOperation?:MediaOperationObserver,execute=runMediaOperation){
  const key='sampled-v2-'+cacheKey(path)+'-'+Math.round(sourceIn*1000)+'-'+Math.round(sourceOut*1000),file=join(cacheDir,key+'.quality.json');
  if(existsSync(file))return JSON.parse(readFileSync(file,'utf8'));
  // Decode at most three representative frames. fps/scale run before quality metrics,
  // so full-resolution/high-FPS frames never enter the expensive filters.
  const duration=Math.max(.1,sourceOut-sourceIn),sampleTimes=still?[0]:[.15,.5,.85].map(x=>Math.min(duration-.05,Math.max(.05,duration*x)));
  let black=0,blur:number[]=[];
  try{for(const offset of sampleTimes){const args=['-hide_banner','-ss',String((still?0:sourceIn)+offset),'-i',path,'-frames:v','1','-vf','scale=320:-2,blackdetect=d=0.01:pix_th=0.1,blurdetect','-an','-f','null','-'];const stderr=await execute('ffmpeg',args,path,'quality sampling',signal,12000,onOperation);black+=([...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].reduce((n,m)=>n+Number(m[2])-Number(m[1]),0));blur.push(...[...stderr.matchAll(/blur mean:\s*([\d.]+)/g)].map(m=>Number(m[1])));}}
  catch(error){const quality={usable:true,qualityStatus:/timed out/i.test(String(error))?'TIMEOUT':'UNKNOWN',blackSeconds:null,blurScore:null,sceneCuts:null,method:'sampled low-resolution quality check; optional failure fallback'};writeFileSync(file,JSON.stringify(quality));return quality;}
  const quality={usable:black<Math.min(1,duration*.5),qualityStatus:'KNOWN',blackSeconds:black,blurScore:blur.length?blur.reduce((a,b)=>a+b,0)/blur.length:null,sceneCuts:null,method:'three sampled 320px FFmpeg frames; no duplicate scene detection'};
  writeFileSync(file,JSON.stringify(quality));return quality;
}
