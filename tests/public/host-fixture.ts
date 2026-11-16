import vm from 'node:vm';
import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync,statSync} from 'node:fs';
import {basename} from 'node:path';
const ticks=254016000000;
export function hostFixture(videoCount=1){
  let serial=0,failAfter=-1,writes=0;
  class Time {private value=0;get seconds(){return this.value}set seconds(n:number){this.value=n}get ticks(){return String(this.value*ticks)}set ticks(n:string){this.value=Number(n)/ticks}}
  const time=(n:number)=>{const t=new Time();t.seconds=n;return t};
  const collection=(items:any[],key:string)=>{const out:any={[key]:items.length};items.forEach((x,i)=>out[i]=x);return out};
  const root:any={children:collection([],'numItems')},items:any[]=[];
  function item(path:string,span=12,kind='both',name=basename(path)){const x:any={nodeId:'item-'+serial++,name,getMediaPath:()=>path,sourceIn:0,sourceOut:span,kind,setInPoint(n:number){this.sourceIn=n},setOutPoint(n:number){this.sourceOut=n},createSubClip(name:string,_start:string,end:string,_hard:number,video:number,audio:number){return item(path,Number(end)/ticks,video?'video':'audio',name)}};items.push(x);root.children=collection(items,'numItems');return x}
  function track(kind:string){const list:any[]=[],t:any={muted:false,isMuted(){return this.muted},setMute(n:number){this.muted=!!n},clips:collection(list,'numItems')};
    t.add=(x:any,start:number,sourceIn=x.sourceIn,sourceOut=x.sourceOut)=>{if(failAfter>=0&&writes++===failAfter)throw Error('simulated host interruption');const c:any={nodeId:'clip-'+serial++,name:x.name,projectItem:x,start:time(start),end:time(start+sourceOut-sourceIn),inPoint:time(sourceIn),outPoint:time(sourceOut),isEnabled:()=>true,remove(){list.splice(list.indexOf(c),1);t.clips=collection(list,'numItems')}};list.push(c);t.clips=collection(list,'numItems');return c};
    t.overwriteClip=(x:any,start:number)=>{if(kind==='video'&&x.kind==='audio'||kind==='audio'&&x.kind==='video')throw Error('Wrong stream');return t.add(x,start)};return t;
  }
  const sequences:any[]=[];
  const project:any={path:'synthetic-project',rootItem:root,sequences:collection(sequences,'numSequences'),save(){},openSequence(id:string){this.activeSequence=sequences.find(s=>s.sequenceID===id);return true},importFiles(paths:string[]){paths.forEach(p=>item(p));return true}};
  function sequence(name:string,vc:number,ac=1){const video=Array.from({length:vc},()=>track('video')),audio=Array.from({length:ac},()=>track('audio'));const s:any={sequenceID:'sequence-'+serial++,name,timebase:ticks/30,end:time(12),videoTracks:collection(video,'numTracks'),audioTracks:collection(audio,'numTracks'),getSettings:()=>({videoFrameWidth:1080,videoFrameHeight:1920}),clone(){const clone=sequence('copy',video.length,audio.length);for(const key of ['videoTracks','audioTracks'])for(let i=0;i<this[key].numTracks;i++)for(let j=0;j<this[key][i].clips.numItems;j++){const c=this[key][i].clips[j];clone[key][i].add(c.projectItem,c.start.seconds,c.inPoint.seconds,c.outPoint.seconds)}return {getSequence:()=>clone}},append(v:number,a:number){for(let i=0;i<v;i++)video.push(track('video'));for(let i=0;i<a;i++)audio.push(track('audio'));s.videoTracks=collection(video,'numTracks');s.audioTracks=collection(audio,'numTracks')}};sequences.push(s);project.sequences=collection(sequences,'numSequences');return s}
  const source=sequence('Synthetic shapes source',videoCount);source.videoTracks[0].add(item('synthetic-original.mov'),0);project.activeSequence=source;
  class File {fsName:string;name:string;encoding='UTF-8';mode='';buffer='';constructor(p:string){this.fsName=p;this.name=basename(p)}get exists(){return existsSync(this.fsName)}get length(){return statSync(this.fsName).size}open(mode:string){this.mode=mode;return true}read(){return readFileSync(this.fsName,'utf8')}write(x:string){this.buffer=x}close(){if(this.mode==='w')writeFileSync(this.fsName,this.buffer)}remove(){unlinkSync(this.fsName);return true}rename(name:string){const target=this.fsName.slice(0,this.fsName.length-this.name.length)+name;renameSync(this.fsName,target);this.fsName=target;this.name=name;return true}}
  const context:any={app:{project,enableQE(){}},qe:{project:{getActiveSequence:()=>({guid:project.activeSequence.sequenceID,addTracks(v:number,_after:number,a:number){project.activeSequence.append(v,a)}})}},File,Time,$:{sleep(){}}};
  const script=readFileSync('apps/premiere-panel-v2/host.jsx','utf8');vm.runInNewContext(script,context);
  const call=async(op:string,args:any={})=>{const result=JSON.parse(context.NajmV2.dispatch(JSON.stringify({operation:op,args})));if(!result.ok)throw Error(result.error);return result.result};
  return {source,project,sequences,item,call,connected:true,acknowledgeReconciliation(){},restart(){delete context.NajmV2;vm.runInNewContext(script,context)},failNext(n:number){writes=0;failAfter=n},noFailure(){failAfter=-1}};
}
