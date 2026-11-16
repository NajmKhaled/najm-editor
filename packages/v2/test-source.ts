import {existsSync} from 'node:fs';
import {basename} from 'node:path';
import type {TestSection} from './test-section.js';

const videoFile=/\.(mp4|mov|mxf|avi|mkv|webm|mts|m2ts)$/i;
const audioFile=/\.(wav|m4a|mp3|aac|flac|aiff|wma)$/i;
const generated=/^NAJM_(?:EDIT|TEST)_\d+$/i;
const pathKey=(value:string)=>value.replace(/\//g,'\\').toLowerCase();

export interface SourceChoice {id:string;name:string;snapshot:any;videoPaths:string[];audioPaths:string[];unseenVideoCount:number}

/** A finished timeline is evidence, not a raw-media inventory. */
export function chooseSourceSequence(rows:{id:string;name:string;snapshot:any}[],referenceId:string,reference:any):SourceChoice|undefined {
  const referenceVideo=new Set((reference?.videoTracks||[]).flatMap((t:any)=>(t.clips||[]).map((c:any)=>pathKey(String(c.mediaPath||''))).filter(Boolean)));
  const choices:SourceChoice[]=[];
  for(const row of rows){
    if(row.id===referenceId||generated.test(row.name)||/^Synthetic reference$/i.test(row.name))continue;
    const snapshot=row.snapshot;
    const videoPaths:string[]=[...new Set<string>((snapshot?.videoTracks||[]).flatMap((t:any)=>(t.clips||[]).map((c:any)=>String(c.mediaPath||''))).filter((p:string)=>videoFile.test(p)&&existsSync(p)))];
    const audioPaths:string[]=[...new Set<string>((snapshot?.audioTracks||[]).flatMap((t:any)=>(t.clips||[]).map((c:any)=>String(c.mediaPath||''))).filter((p:string)=>!!p&&existsSync(p)))];
    if(!videoPaths.length||!audioPaths.length||!Number.isFinite(Number(snapshot?.duration))||Number(snapshot.duration)<=0)continue;
    const graphicCount=(snapshot.videoTracks||[]).flatMap((t:any)=>t.clips||[]).filter((c:any)=>!c.mediaPath).length;
    const similarToReference=reference&&Math.abs(Number(snapshot.duration)-Number(reference.duration))<.1&&videoPaths.length>1&&videoPaths.filter(p=>referenceVideo.has(pathKey(p))).length/videoPaths.length>.8;
    if(graphicCount>0||similarToReference)continue;
    choices.push({...row,videoPaths,audioPaths,unseenVideoCount:videoPaths.filter(p=>!referenceVideo.has(pathKey(p))).length});
  }
  return choices.sort((a,b)=>b.unseenVideoCount-a.unseenVideoCount||b.videoPaths.length-a.videoPaths.length||a.name.localeCompare(b.name)||a.id.localeCompare(b.id))[0];
}

export function discoverBinMedia(items:any[],reference:any){
  const referencePaths=(reference?.videoTracks||[]).flatMap((t:any)=>(t.clips||[]).map((c:any)=>pathKey(String(c.mediaPath||''))));
  const used=new Set<string>(referencePaths.filter(Boolean));
  const paths=new Set<string>(),videos:{path:string;name:string;unseen:boolean}[]=[],audio:{path:string;name:string}[]=[];
  for(const item of items||[]){const path=String(item.mediaPath||'');if(!path||!existsSync(path)||paths.has(pathKey(path)))continue;paths.add(pathKey(path));const name=String(item.name||basename(path));if(videoFile.test(path))videos.push({path,name,unseen:!used.has(pathKey(path))});else if(audioFile.test(path)&&!/(music|soundtrack|sound.effect|\bbgm\b|موسيقى)/i.test(name))audio.push({path,name})}
  videos.sort((a,b)=>Number(b.unseen)-Number(a.unseen)||a.name.localeCompare(b.name));
  const marked=audio.filter(x=>/(voice|narrat|speech|record|dialog|تسجيل|تعليق|صوت)/i.test(x.name));
  const narration=marked.length===1?marked[0]:audio.length===1?audio[0]:undefined;
  return {videos,audio,narration,ambiguity:!narration&&audio.length>1?'Multiple possible narration files: '+audio.slice(0,8).map(x=>x.name).join(', '):undefined};
}

/** Select complete, unused speech phrases; duration is a processing ceiling, not a user target. */
export function selectAutomaticTestSection(phrases:any[],duration:number,used:TestSection[]=[]):TestSection {
  const valid=(phrases||[]).filter(p=>Number.isFinite(Number(p.start))&&Number.isFinite(Number(p.end))&&p.end>p.start&&String(p.text||'').trim()).sort((a,b)=>a.start-b.start);
  const overlaps=(section:TestSection)=>used.some(old=>Math.max(old.start,section.start)<Math.min(old.end,section.end)-.02);
  const candidates:{section:TestSection;score:number}[]=[];
  for(let i=0;i<valid.length;i++)for(let j=i;j<valid.length;j++){
    if(j>i&&Number(valid[j].start)-Number(valid[j-1].end)>2.5)break;
    const start=Math.max(0,Number(valid[i].start)-.15),end=Math.min(duration,Number(valid[j].end)+.15),length=end-start;
    if(length>30)break;if(length<3||overlaps({start,end}))continue;
    const count=j-i+1,words=valid.slice(i,j+1).reduce((n,p)=>n+String(p.text).trim().split(/\s+/).length,0);
    if(words<4)continue;
    const score=Math.min(length,18)*2+Math.min(words,45)+count*2-Math.max(0,length-20)*2-start*.03;
    candidates.push({section:{start,end},score});
  }
  const best=candidates.sort((a,b)=>b.score-a.score||a.section.start-b.section.start||a.section.end-b.section.end)[0];
  if(!best&&used.length)return selectAutomaticTestSection(phrases,duration,[]);
  if(!best)throw Error('No complete Arabic narration section of at least three seconds was found. Add a narration clip with audible speech.');
  return best.section;
}

export function compareTestSourceUse(shots:any[],referenceFrames:any[]){
  const observed=(referenceFrames||[]).filter(x=>x.status==='OBSERVED'&&x.mediaPath&&Number.isFinite(Number(x.sourceTime)));
  const referencePaths=new Set(observed.map(x=>pathKey(String(x.mediaPath))));
  const paths=[...new Set((shots||[]).map(x=>pathKey(String(x.source_media||''))).filter(Boolean))];
  const sharedSourcePaths=paths.filter(x=>referencePaths.has(x)).length;
  const sharedSourceMoments=(shots||[]).filter(shot=>observed.some(row=>pathKey(String(row.mediaPath))===pathKey(String(shot.source_media||''))&&Number(row.sourceTime)>=Number(shot.source_in)-.05&&Number(row.sourceTime)<=Number(shot.source_out)+.05)).length;
  return {sourceCount:paths.length,sharedSourcePaths,novelSourcePaths:paths.length-sharedSourcePaths,sharedSourceMoments,limitation:paths.length&&sharedSourcePaths===paths.length?'All selected sources also appear in the reference; this TEST gives limited evidence of footage generalization.':null};
}
