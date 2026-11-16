import {Resvg} from '@resvg/resvg-js';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
/** Original neutral design. System fonts only; no font or private template is bundled. */
export function neutralSvg(text:string,kind:'caption'|'title',width=1080,height=1920){
  const y=height*(kind==='title'?.20:.76),font=kind==='title'?64:50;
  const words=text.trim().split(/\s+/),lines:string[]=[];let line='';
  for(const word of words){if((line+' '+word).length>28&&line){lines.push(line);line=''}line+=(line?' ':'')+word}if(line)lines.push(line);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1080 1920"><rect x="54" y="${y-70}" width="972" height="${lines.length*78+38}" rx="18" fill="#101827" fill-opacity="0.92"/>${lines.map((line,i)=>`<text x="540" y="${y+i*78}" text-anchor="middle" font-family="Arial,DejaVu Sans,sans-serif" font-size="${font}" fill="white">${escape(line)}</text>`).join('')}</svg>`;
}
export function neutralGraphic(dir:string,text:string,kind:'caption'|'title'){
  mkdirSync(dir,{recursive:true});const svg=neutralSvg(text,kind),digest=createHash('sha256').update(svg).digest('hex').slice(0,20),path=join(dir,kind+'-'+digest+'.png');
  writeFileSync(path,new Resvg(svg,{font:{loadSystemFonts:true,defaultFontFamily:process.platform==='win32'?'Arial':'DejaVu Sans'}}).render().asPng());return path;
}
