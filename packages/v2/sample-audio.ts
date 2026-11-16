import {createHash} from 'node:crypto';
import {closeSync,createReadStream,existsSync,mkdirSync,openSync,readFileSync,readSync,writeFileSync,writeSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {probe,run} from '../pipeline/process.js';

const RATE=48000;
const index=(seconds:number,rate:number)=>{
  if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid audio timestamp');
  return Math.round(seconds*rate);
};
const save=(path:string,value:unknown)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value,null,2))};
const load=(path:string)=>{try{return JSON.parse(readFileSync(path,'utf8'))}catch{return null}};
const digest=(path:string)=>new Promise<string>((resolve,reject)=>{const hash=createHash('sha256'),stream=createReadStream(path);stream.on('data',chunk=>hash.update(chunk));stream.on('error',reject);stream.on('end',()=>resolve(hash.digest('hex')))});
async function properties(path:string,dir:string,signal?:AbortSignal){const data=await probe(path,dir,signal),stream=(data.streams||[]).find((s:any)=>s.codec_type==='audio');if(!stream)throw Error('Audio stream missing: '+path);return {codec:String(stream.codec_name),rate:Number(stream.sample_rate),channels:Number(stream.channels),frames:Number(stream.duration_ts),duration:Number(stream.duration),stream}}
function requireCanonical(p:Awaited<ReturnType<typeof properties>>){if(p.codec!=='pcm_s24le'||p.rate<44100||![1,2].includes(p.channels)||!Number.isSafeInteger(p.frames))throw Error('Production audio must be a canonical 24-bit PCM WAV at 44.1 kHz or higher, mono or stereo')}
function wavData(fd:number){const head=Buffer.alloc(12);if(readSync(fd,head,0,12,0)!==12||head.toString('ascii',0,4)!=='RIFF'||head.toString('ascii',8,12)!=='WAVE')throw Error('Canonical audio must be RIFF WAV');let offset=12,format=0,channels=0,rate=0,bits=0,block=0,dataOffset=-1,dataBytes=0;for(;;){const chunk=Buffer.alloc(8);if(readSync(fd,chunk,0,8,offset)!==8)break;const id=chunk.toString('ascii',0,4),size=chunk.readUInt32LE(4),payload=offset+8;if(id==='fmt '){const fmt=Buffer.alloc(Math.min(size,40));readSync(fd,fmt,0,fmt.length,payload);format=fmt.readUInt16LE(0);channels=fmt.readUInt16LE(2);rate=fmt.readUInt32LE(4);block=fmt.readUInt16LE(12);bits=fmt.readUInt16LE(14)}if(id==='data'){dataOffset=payload;dataBytes=size;break}offset=payload+size+(size%2)}if(![1,0xfffe].includes(format)||bits!==24||block!==channels*3||dataOffset<0||dataBytes%block)throw Error('Canonical audio must contain aligned 24-bit PCM samples');return {channels,rate,block,dataOffset,frames:dataBytes/block}}
function wavHeader(rate:number,channels:number,frames:number){const bytes=frames*channels*3;if(bytes>0xffffffff-36)throw Error('Clean narration exceeds RIFF WAV capacity');const h=Buffer.alloc(44);h.write('RIFF',0,'ascii');h.writeUInt32LE(36+bytes,4);h.write('WAVEfmt ',8,'ascii');h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(channels,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*channels*3,28);h.writeUInt16LE(channels*3,32);h.writeUInt16LE(24,34);h.write('data',36,'ascii');h.writeUInt32LE(bytes,40);return h}
function smooth(buf:Buffer,frames:number,channels:number,segmentOffset:number,segmentFrames:number,fadeIn:number,fadeOut:number){for(let frame=0;frame<frames;frame++){const position=segmentOffset+frame;let gain=1;if(fadeIn&&position<fadeIn)gain*=position/fadeIn;if(fadeOut&&position>=segmentFrames-fadeOut)gain*=(segmentFrames-1-position)/fadeOut;if(gain===1)continue;for(let c=0;c<channels;c++){const at=(frame*channels+c)*3,raw=buf[at]|buf[at+1]<<8|buf[at+2]<<16,value=raw&0x800000?raw-0x1000000:raw,scaled=Math.max(-8388608,Math.min(8388607,Math.round(value*gain))),unsigned=scaled<0?scaled+0x1000000:scaled;buf[at]=unsigned&255;buf[at+1]=(unsigned>>8)&255;buf[at+2]=(unsigned>>16)&255}}}
function assemblePcm(source:string,out:string,ranges:{startSample:number;endSample:number;samples:number}[],rate:number,channels:number,fadeSamples:number){const input=openSync(source,'r'),output=openSync(out,'w');try{const wav=wavData(input),total=ranges.reduce((n,r)=>n+r.samples,0);if(wav.rate!==rate||wav.channels!==channels||ranges.some(r=>r.endSample>wav.frames))throw Error('Canonical WAV metadata or segment bounds changed');writeSync(output,wavHeader(rate,channels,total));const chunkFrames=65536;let target=44;for(let i=0;i<ranges.length;i++){const r=ranges[i],fade=Math.min(fadeSamples,Math.floor(r.samples/4)),fadeIn=i?fade:0,fadeOut=i<ranges.length-1?fade:0;for(let offset=0;offset<r.samples;offset+=chunkFrames){const frames=Math.min(chunkFrames,r.samples-offset),buf=Buffer.allocUnsafe(frames*wav.block),position=wav.dataOffset+(r.startSample+offset)*wav.block;if(readSync(input,buf,0,buf.length,position)!==buf.length)throw Error('Canonical WAV ended within selected narration range');smooth(buf,frames,channels,offset,r.samples,fadeIn,fadeOut);writeSync(output,buf,0,buf.length,target);target+=buf.length}}if(target!==44+total*wav.block)throw Error('Clean narration write count differs from selected samples')}finally{closeSync(output);closeSync(input)}}

/** Establish the one production sample domain before any narration cuts. */
export async function canonicalAudioFromTrack(track:any,dir:string,signal?:AbortSignal){
  const clips=(track.clips||[]).filter((x:any)=>x.mediaPath).sort((a:any,b:any)=>a.start-b.start);
  if(!clips.length)throw Error('Narration track has no online media');
  const streams=await Promise.all(clips.map((c:any)=>properties(c.mediaPath,join(dir,'probe'),signal)));
  const channels=Math.max(...streams.map(s=>s.channels));if(![1,2].includes(channels))throw Error('Multichannel narration requires explicit channel mapping');
  const rate=Math.max(RATE,...streams.map(s=>s.rate)),layout=channels===1?'mono':'stereo';
  const identity=await Promise.all(clips.map(async(c:any,i:number)=>[c.mediaPath,await digest(c.mediaPath),c.start,c.end,c.sourceIn,c.sourceOut,streams[i].rate,streams[i].channels]));
  const key=createHash('sha256').update(JSON.stringify(['production-samples-v2',rate,channels,identity])).digest('hex');
  const out=join(dir,'production-audio-'+key+'.wav');
  if(existsSync(out)){try{const p=await properties(out,join(dir,'probe'),signal);requireCanonical(p);if(p.rate===rate&&p.channels===channels&&p.frames===index(Math.max(...clips.map((c:any)=>c.end)),rate))return out}catch{}}
  const args=['-hide_banner','-loglevel','error'];
  for(const c of clips){if(Math.abs((c.sourceOut-c.sourceIn)-(c.end-c.start))>.12)throw Error('Narration source has unsupported speed change: '+c.name);args.push('-ss',String(c.sourceIn),'-t',String(c.end-c.start),'-i',c.mediaPath)}
  const filters=clips.map((c:any,i:number)=>{const samples=index(c.end-c.start,rate),delay=index(c.start,rate);return `[${i}:a]aresample=${rate},aformat=sample_fmts=fltp:channel_layouts=${layout},apad,atrim=end_sample=${samples},adelay=${delay}S:all=1[a${i}]`});
  const total=index(Math.max(...clips.map((c:any)=>c.end)),rate);
  filters.push(clips.map((_:any,i:number)=>`[a${i}]`).join('')+`amix=inputs=${clips.length}:duration=longest:normalize=0,apad,atrim=end_sample=${total}[out]`);
  mkdirSync(dir,{recursive:true});await run('ffmpeg',[...args,'-filter_complex',filters.join(';'),'-map','[out]','-ar',String(rate),'-ac',String(channels),'-c:a','pcm_s24le','-y',out],signal,3600000);
  const rendered=await properties(out,join(dir,'probe'),signal);requireCanonical(rendered);if(rendered.frames!==total)throw Error(`Canonical production render returned ${rendered.frames} samples instead of ${total}`);
  return out;
}

export async function makeCleanAudio(audio:string,segments:any[],dir:string,signal?:AbortSignal,boundaryMs=8){
  if(!Number.isFinite(boundaryMs)||boundaryMs<0||boundaryMs>20)throw Error('Invalid narration boundary smoothing');
  if(!segments.length)throw Error('No narration segments');
  const source=await properties(audio,join(dir,'probe'),signal);requireCanonical(source);
  const ranges=segments.map((s:any)=>{const startSample=index(Number(s.source_start),source.rate),endSample=index(Number(s.source_end),source.rate);if(endSample<=startSample||endSample>source.frames)throw Error('Invalid narration segment');return {startSample,endSample,samples:endSample-startSample,text:s.corrected_text}});
  const fadeSamples=index(boundaryMs/1000,source.rate),expectedSamples=ranges.reduce((n,r)=>n+r.samples,0);
  const key=createHash('sha256').update(JSON.stringify(['clean-samples-v3',await digest(audio),ranges,boundaryMs])).digest('hex').slice(0,20);
  const out=join(dir,'NAJM_CLEAN_'+key+'.wav'),map=join(dir,'NAJM_CLEAN_'+key+'.json');
  if(existsSync(out)&&existsSync(map)){const cached=load(map),validMapping=cached?.mapping?.length===ranges.length&&cached.mapping.every((m:any,i:number)=>m.source===audio&&m.sourceStartSample===ranges[i].startSample&&m.sourceEndSample===ranges[i].endSample&&m.cleanStartSample===(i?cached.mapping[i-1].cleanEndSample:0)&&m.cleanEndSample-m.cleanStartSample===ranges[i].samples);if(cached?.version===3&&cached.path===out&&cached.source===audio&&cached.expectedSamples===expectedSamples&&validMapping){try{const p=await properties(out,join(dir,'probe'),signal);if(p.frames===expectedSamples&&p.rate===source.rate&&p.channels===source.channels&&p.codec==='pcm_s24le')return cached}catch{}}}
  let elapsed=0;const mapping:any[]=[];
  for(let i=0;i<ranges.length;i++){
    const r=ranges[i];
    mapping.push({source:audio,sourceStartSample:r.startSample,sourceEndSample:r.endSample,cleanStartSample:elapsed,cleanEndSample:elapsed+r.samples,sourceStart:r.startSample/source.rate,sourceEnd:r.endSample/source.rate,cleanStart:elapsed/source.rate,cleanEnd:(elapsed+r.samples)/source.rate,text:r.text,words:[]});
    elapsed+=r.samples;
  }
  mkdirSync(dir,{recursive:true});assemblePcm(audio,out,ranges,source.rate,source.channels,fadeSamples);
  const rendered=await properties(out,join(dir,'probe'),signal);if(rendered.frames!==expectedSamples)throw Error(`Clean narration assembly returned ${rendered.frames} samples instead of ${expectedSamples}`);
  const result={version:3,path:out,source:audio,duration:expectedSamples/source.rate,expectedSamples,mapping,boundaryMs,sampleRate:source.rate,channels:source.channels,codec:'pcm_s24le'};save(map,result);return result;
}

function signed24(data:Buffer,at:number){const raw=data[at]|data[at+1]<<8|data[at+2]<<16;return (raw&0x800000?raw-0x1000000:raw)/8388608}
function compareWindows(sourcePath:string,cleanPath:string,sourceStart:number,cleanStart:number,frames:number,channels:number,signal?:AbortSignal){const aFd=openSync(sourcePath,'r'),bFd=openSync(cleanPath,'r');try{const aWav=wavData(aFd),bWav=wavData(bFd);if(aWav.channels!==channels||bWav.channels!==channels||sourceStart+frames>aWav.frames||cleanStart+frames>bWav.frames)throw Error('Mapped source and clean sample counts differ');const stats=Array.from({length:channels},()=>({sx:0,sy:0,sxx:0,syy:0,sxy:0}));let sourceEnergy=0,cleanEnergy=0,sourcePeak=0,cleanPeak=0;for(let offset=0;offset<frames;offset+=65536){if(signal?.aborted)throw Error('Audio validation aborted');const count=Math.min(65536,frames-offset),bytes=count*channels*3,a=Buffer.allocUnsafe(bytes),b=Buffer.allocUnsafe(bytes);if(readSync(aFd,a,0,bytes,aWav.dataOffset+(sourceStart+offset)*aWav.block)!==bytes||readSync(bFd,b,0,bytes,bWav.dataOffset+(cleanStart+offset)*bWav.block)!==bytes)throw Error('Mapped source and clean sample counts differ');for(let frame=0;frame<count;frame++)for(let channel=0;channel<channels;channel++){const at=(frame*channels+channel)*3,x=signed24(a,at),y=signed24(b,at),s=stats[channel];s.sx+=x;s.sy+=y;s.sxx+=x*x;s.syy+=y*y;s.sxy+=x*y;sourceEnergy+=x*x;cleanEnergy+=y*y;sourcePeak=Math.max(sourcePeak,Math.abs(x));cleanPeak=Math.max(cleanPeak,Math.abs(y))}}const db=(x:number)=>x>0?20*Math.log10(x):-120;return {channels:stats.map((s,channel)=>{const vx=s.sxx-s.sx*s.sx/frames,vy=s.syy-s.sy*s.sy/frames;return {channel:channel+1,correlation:vx>1e-16&&vy>1e-16?(s.sxy-s.sx*s.sy/frames)/Math.sqrt(vx*vy):null}}),source:{meanDb:db(Math.sqrt(sourceEnergy/(frames*channels))),peakDb:db(sourcePeak)},clean:{meanDb:db(Math.sqrt(cleanEnergy/(frames*channels))),peakDb:db(cleanPeak)}}}finally{closeSync(aFd);closeSync(bFd)}}
export async function validateCleanAudio(sourcePath:string,clean:any,dir:string,signal?:AbortSignal){
  if(!existsSync(clean.path))throw Error('Clean narration file is missing');
  const [source,output]=await Promise.all([properties(sourcePath,dir,signal),properties(clean.path,dir,signal)]);
  requireCanonical(source);if(output.codec!=='pcm_s24le')throw Error('Clean narration must be uncompressed 24-bit PCM');if(output.rate!==source.rate)throw Error('Clean narration sample rate was degraded');if(output.channels!==source.channels)throw Error('Clean narration channel count changed');
  const mapping=clean.mapping;if(!Array.isArray(mapping)||!mapping.length)throw Error('Clean narration source mapping is missing');
  const expected=mapping.reduce((n:number,m:any)=>n+(m.sourceEndSample-m.sourceStartSample),0);
  if(output.frames!==expected||clean.expectedSamples!==expected)throw Error(`Mapped source and clean sample counts differ by ${Math.abs(output.frames-expected)} frames (${expected} versus ${output.frames})`);
  const boundary=index(Number(clean.boundaryMs||0)/1000,output.rate),segments:any[]=[],errors:string[]=[];
  for(let i=0;i<mapping.length;i++){
    const m=mapping[i],samples=m.sourceEndSample-m.sourceStartSample;if(m.source!==sourcePath||m.cleanEndSample-m.cleanStartSample!==samples||m.sourceStartSample<0||m.sourceEndSample>source.frames||m.cleanStartSample<0||m.cleanEndSample>output.frames||i&&m.cleanStartSample!==mapping[i-1].cleanEndSample)throw Error('Invalid clean narration mapping at segment '+(i+1));
    const trimStart=i?Math.min(boundary,Math.floor(samples/4)):0,trimEnd=i<mapping.length-1?Math.min(boundary,Math.floor(samples/4)):0,sourceWindow={startSample:m.sourceStartSample+trimStart,endSample:m.sourceEndSample-trimEnd},cleanWindow={startSample:m.cleanStartSample+trimStart,endSample:m.cleanEndSample-trimEnd};
    if(sourceWindow.endSample<=sourceWindow.startSample)throw Error('No unaffected interior remains in narration segment '+(i+1));
    const comparedFrames=sourceWindow.endSample-sourceWindow.startSample,levels=compareWindows(sourcePath,clean.path,sourceWindow.startSample,cleanWindow.startSample,comparedFrames,output.channels,signal),meanDeltaDb=levels.clean.meanDb-levels.source.meanDb,peakDeltaDb=levels.clean.peakDb-levels.source.peakDb;
    if(levels.source.peakDb<-.1&&levels.clean.peakDb>=-.1)errors.push(`Clean narration introduced clipping in segment ${i+1}`);
    if(Math.abs(meanDeltaDb)>1.5)errors.push(`Clean narration level changed unexpectedly in segment ${i+1}: delta ${meanDeltaDb.toFixed(2)} dB`);
    for(const channel of levels.channels)if(channel.correlation!==null&&channel.correlation<.98)errors.push(`Clean narration channel ${channel.channel} fidelity changed in segment ${i+1}: correlation ${channel.correlation.toFixed(4)} (possible phase inversion or spectral loss)`);
    segments.push({index:i+1,sourceWindow:{start:sourceWindow.startSample/output.rate,end:sourceWindow.endSample/output.rate,...sourceWindow},cleanWindow:{start:cleanWindow.startSample/output.rate,end:cleanWindow.endSample/output.rate,...cleanWindow},sourceLevels:levels.source,cleanLevels:levels.clean,meanDeltaDb,peakDeltaDb,channelCorrelation:levels.channels,sampleAlignment:{sourceDecodedFrames:comparedFrames,cleanDecodedFrames:comparedFrames,comparedFrames}});
  }
  if(errors.length)throw Error(errors.join('; '));
  return {source:{codec:source.codec,sampleRate:source.rate,channels:source.channels},generated:{codec:output.codec,sampleRate:output.rate,channels:output.channels,duration:output.frames/output.rate,samples:output.frames},levels:{comparison:'corresponding mapped segment interiors',segments,maxAbsoluteMeanDeltaDb:Math.max(...segments.map(x=>Math.abs(x.meanDeltaDb)))},expectedSamples:expected,expectedDuration:expected/output.rate,boundaryMs:clean.boundaryMs,captionTimingSource:'verified clean narration',pass:true};
}
