import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {run,probe} from '../pipeline/process.js';
import {openLocalBrowser} from './local-browser.js';
import {lowerThirdHtml,validateMotionSelection,type MotionSelection} from './motion-contract.js';

function alphaFrame(path:string,time:number):Promise<Buffer>{return new Promise((resolve,reject)=>{const chunks:Buffer[]=[],p=spawn('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(time),'-i',path,'-frames:v','1','-vf','alphaextract','-f','rawvideo','-pix_fmt','gray','pipe:1'],{windowsHide:true,shell:false});let bytes=0;const timer=setTimeout(()=>p.kill(),30000);p.stdout.on('data',b=>{bytes+=b.length;if(bytes>8*1024*1024){p.kill();return}chunks.push(b)});p.on('error',reject);p.on('close',code=>{clearTimeout(timer);code===0?resolve(Buffer.concat(chunks)):reject(Error('Alpha verification failed'))});});}
export async function verifyMotion(path:string,plan:MotionSelection,dir:string){
 const metadata=await probe(path,join(dir,'probe')),video=metadata.streams.find((s:any)=>s.codec_type==='video'),duration=Number(metadata.format.duration),span=plan.end-plan.start;
 const [n,d]=String(video?.avg_frame_rate||'0/1').split('/').map(Number);
 if(video?.codec_name!=='prores'||!String(video?.pix_fmt).startsWith('yuva')||Number(video?.width)!==plan.width||Number(video?.height)!==plan.height||Math.abs(n/d-plan.fps)>.001||Math.abs(duration-span)>1/plan.fps+.001)throw Error('Rendered overlay duration, format or alpha channel differs');
 const samples=await Promise.all([0,span/2,span-1/plan.fps].map(t=>alphaFrame(path,t)));
 const stats=samples.map(b=>({pixels:b.length,transparent:b.reduce((n,v)=>n+(v<3?1:0),0),foreground:b.reduce((n,v)=>n+(v>100?1:0),0)}));
 if(stats.some(s=>s.pixels!==plan.width*plan.height)||stats[1].transparent<plan.width*plan.height*.5||stats[1].foreground<100||stats[0].foreground||stats[2].foreground)throw Error('Overlay alpha smoke test failed');
 return {codec:'ProRes 4444',fps:plan.fps,width:plan.width,height:plan.height,duration,aspectRatio:plan.width/plan.height,alpha:'VERIFIED_LOCAL',arabicRendering:'LOCAL_BROWSER_SAMPLE_REVIEW_REQUIRED',premiereImport:'PENDING',samples:stats};
}
export async function renderLowerThird(value:unknown,sequenceDuration:number,dir:string,signal?:AbortSignal){
 const plan=validateMotionSelection(value,sequenceDuration),duration=plan.end-plan.start,frames=Math.round(duration*plan.fps),id=createHash('sha256').update(JSON.stringify(plan)+lowerThirdHtml(plan)).digest('hex').slice(0,20),output=join(dir,'lower-third-'+id+'.mov'),frameDir=join(dir,'frames-'+id);mkdirSync(frameDir,{recursive:true});
 const browser=await openLocalBrowser();
 try{const page=await browser.newPage({viewport:{width:plan.width,height:plan.height},deviceScaleFactor:1});await page.route('**/*',(route:any)=>route.abort());await page.setContent(lowerThirdHtml(plan));await page.evaluate((text:any)=>(window as any).setGraphic(text),plan.text);await page.evaluate(()=>document.fonts.ready);
  for(let i=0;i<frames;i++){signal?.throwIfAborted();await page.evaluate(({t,d}:any)=>(window as any).renderFrame(t,d),{t:i/plan.fps,d:duration});await page.screenshot({path:join(frameDir,String(i).padStart(5,'0')+'.png'),omitBackground:true});}
 }finally{await browser.close();}
 await run('ffmpeg',['-hide_banner','-loglevel','error','-framerate',String(plan.fps),'-i',join(frameDir,'%05d.png'),'-frames:v',String(frames),'-c:v','prores_ks','-profile:v','4444','-pix_fmt','yuva444p10le','-alpha_bits','16','-map_metadata','-1','-an','-y',output],signal,120000);
 const verification=await verifyMotion(output,plan,dir),manifest={schemaVersion:1,preset:plan.preset,plan,verification,graphicsKind:'RENDERED_OVERLAY_NOT_EDITABLE_MOGRT'};writeFileSync(output+'.json',JSON.stringify(manifest,null,2));return {path:output,plan,verification,frameDir};
}
