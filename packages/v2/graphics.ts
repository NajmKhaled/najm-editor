import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {runPython} from '../pipeline/python-runtime.js';
import {neutralGraphic} from './neutral-graphics.js';
import type {AgentLocalSettings} from './agent-settings.js';

type Graphic = {start:number;end:number;text:string;templatePath:string};
const root=resolve();
export function graphicsAssetsReady(){return process.env.NAJM_GRAPHICS_MODE!=='native'||existsSync(resolve('templates','CAPTION_AR.mogrt'))&&existsSync(resolve('templates','TITLE_AR.mogrt'));}

function titleLines(text:string):[string,string]{
  const words=text.trim().split(/\s+/).filter(Boolean);
  if(words.length<2)throw Error('The native two-line Arabic title requires at least two words');
  let split=1,score=Infinity;
  for(let i=1;i<words.length;i++){
    const left=words.slice(0,i).join(' '),right=words.slice(i).join(' ');
    const difference=Math.abs(left.length-right.length);
    if(difference<score){score=difference;split=i}
  }
  return [words.slice(0,split).join(' '),words.slice(split).join(' ')];
}

async function variant(templatePath:string,outputDir:string,label:string,texts:string[],signal?:AbortSignal){
  if(!existsSync(templatePath))throw Error('Arabic MOGRT template missing: '+templatePath);
  const digest=createHash('sha256').update(readFileSync(templatePath)).update(readFileSync(resolve('tools/v2_mogrt_text.py'))).update(JSON.stringify(texts)).digest('hex').slice(0,16);
  const outputPath=join(outputDir,label+'-'+digest+'.mogrt');
  if(!existsSync(outputPath))await runPython(['tools/v2_mogrt_text.py',templatePath,outputPath,...texts],{signal,timeoutMs:30000,cwd:root});
  if(!existsSync(outputPath))throw Error('Native Arabic graphic variant was not created: '+outputPath);
  return outputPath;
}

export async function prepareArabicGraphics(jobDir:string,captions:{start:number;end:number;text:string}[],title:{start:number;end:number;text:string},signal?:AbortSignal,settings?:AgentLocalSettings){
  const dir=join(jobDir,'graphics-variants');mkdirSync(dir,{recursive:true});
  if(settings&&(process.env.NAJM_GRAPHICS_MODE!=='native'||settings.templates.caption||settings.templates.title)){
    const resolveGraphic=async(kind:'caption'|'title',x:{start:number;end:number;text:string},i:number)=>{
      const local=settings.templates[kind];
      if(local?.compatibility==='EDITOR_CONFIRMED')return {...x,templatePath:await variant(local.path,dir,kind+'-'+i,kind==='title'?titleLines(x.text):[x.text],signal),graphicsKind:'EDITABLE_MOGRT'};
      return {...x,templatePath:neutralGraphic(dir,x.text,kind),graphicsKind:'RENDERED_PNG_NOT_EDITABLE_MOGRT'};
    };
    const rendered=[];for(let i=0;i<captions.length;i++)rendered.push(await resolveGraphic('caption',captions[i],i));
    return {captions:rendered,title:await resolveGraphic('title',title,0)};
  }
  if(process.env.NAJM_GRAPHICS_MODE!=='native')return {captions:captions.map(x=>({...x,templatePath:neutralGraphic(dir,x.text,'caption')})),title:{...title,templatePath:neutralGraphic(dir,title.text,'title')}};
  const captionTemplate=resolve('templates','CAPTION_AR.mogrt'),titleTemplate=resolve('templates','TITLE_AR.mogrt');
  const renderedCaptions:Graphic[]=[];
  for(let i=0;i<captions.length;i++){
    const x=captions[i];
    renderedCaptions.push({...x,templatePath:await variant(captionTemplate,dir,'caption-'+String(i+1).padStart(2,'0'),[x.text],signal)});
  }
  const parts=titleLines(title.text),renderedTitle={...title,parts,templatePath:await variant(titleTemplate,dir,'title',[...parts],signal)};
  return {captions:renderedCaptions,title:renderedTitle};
}

export function validateEmbeddedGraphics(snapshot:any,plan:{captions:Graphic[];title:Graphic},result:any){
  const tracks=snapshot.videoTracks||[],captionTrack=tracks[result.captionTrackIndex],titleTrack=tracks[result.titleTrackIndex],captionClips=captionTrack?.clips||[],titleClips=titleTrack?.clips||[];
  if(captionTrack?.muted===true||titleTrack?.muted===true)throw Error('Graphics track is muted; review the generated sequence');
  if(captionClips.length!==plan.captions.length)throw Error('Arabic caption graphic count differs: '+captionClips.length+'/'+plan.captions.length);
  if(titleClips.length!==1)throw Error('Arabic title graphic count differs: '+titleClips.length+'/1');
  const check=(clips:any[],expected:Graphic[],reported:any[],kind:string)=>{
    for(let i=0;i<expected.length;i++){
      const x=expected[i],clip=clips.find(c=>Math.abs(c.start-x.start)<.06&&Math.abs(c.end-x.end)<.08),row=(reported||[]).find((r:any)=>r.id===clip?.id);
      if(!clip||!row||row.text!==x.text||row.template!==x.templatePath||!existsSync(x.templatePath))throw Error(kind+' native Arabic graphic missing or text/timing provenance differs at '+x.start);
      if(clip.enabled===false)throw Error(kind+' graphic is disabled');
    }
  };
  check(captionClips,plan.captions,result.captions,'Caption');check(titleClips,[plan.title],result.title,'Title');
  return {captionCount:captionClips.length,titleText:plan.title.text,sourceText:'embedded Premiere native graphic payload'};
}
