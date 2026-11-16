import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';import {Resvg} from '@resvg/resvg-js';
import {run} from '../packages/pipeline/process.js';
const output=resolve('demo/output/media');mkdirSync(output,{recursive:true});
for(const shape of ['circle','square','triangle']){
 const png=join(output,shape+'.png');writeFileSync(png,new Resvg(readFileSync('demo/assets/'+shape+'.svg')).render().asPng());
 await run('ffmpeg',['-hide_banner','-loglevel','error','-loop','1','-i',png,'-vf',"zoompan=z=1.08:x='(iw-iw/zoom)/2+20*sin(on/30)':y='(ih-ih/zoom)/2':d=360:s=540x960:fps=30",'-t','12','-c:v','libx264','-pix_fmt','yuv420p','-y',join(output,shape+'.mp4')]);
}
await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','12','-c:a','pcm_s24le','-y',join(output,'silence.wav')]);
console.log('Created original synthetic motion footage and silent audio in demo/output/media. No narration, font files, templates or downloads.');
