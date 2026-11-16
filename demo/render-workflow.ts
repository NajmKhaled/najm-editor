import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';import {resolve,join} from 'node:path';
import {openLocalBrowser} from '../packages/v2/local-browser.js';import {run} from '../packages/pipeline/process.js';import {runDemo} from './run.js';
await runDemo(resolve('demo/output/slow'),2000);await runDemo(resolve('demo/output/fast'),1000);
const fixture={slow:JSON.parse(readFileSync('demo/output/slow/plan.json','utf8')),fast:JSON.parse(readFileSync('demo/output/fast/plan.json','utf8'))},out=resolve('demo/output/workflow'),frames=join(out,'frames');mkdirSync(frames,{recursive:true});mkdirSync('docs/media',{recursive:true});
writeFileSync('docs/media/agent-comparison.json',JSON.stringify({evidence:'SIMULATED_WORKFLOW_ACTUAL_FIXTURE_PLANS',sameSource:true,...fixture},null,2));
const browser=await openLocalBrowser();
try{const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});await page.route('**/*',(r:any)=>r.abort());await page.setContent(readFileSync('demo/workflow.html','utf8'));await page.evaluate((value:any)=>(window as any).fixture=value,fixture);await page.evaluate(()=>document.fonts.ready);
 for(let i=0;i<240;i++){await page.evaluate((t:number)=>(window as any).renderFrame(t),i/12);await page.screenshot({path:join(frames,String(i).padStart(4,'0')+'.png')});if(i%60===0)console.log('Simulated workflow frames: '+i+' / 240');}
 await page.evaluate(()=>(window as any).renderFrame(13));await page.screenshot({path:'docs/media/agent-comparison.png'});
}finally{await browser.close()}
await run('ffmpeg',['-hide_banner','-loglevel','error','-framerate','12','-i',join(frames,'%04d.png'),'-t','20','-r','24','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','-map_metadata','-1','-an','-y','docs/media/workflow.mp4'],undefined,120000);
await run('ffmpeg',['-hide_banner','-loglevel','error','-framerate','12','-i',join(frames,'%04d.png'),'-t','20','-vf','fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=3','-map_metadata','-1','-loop','0','-y','docs/media/workflow.gif'],undefined,120000);
console.log('Created 20-second simulated workflow, MP4, GIF and matching-time comparison from actual V2 fixture output.');
