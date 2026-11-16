import {readFileSync,writeFileSync} from 'node:fs';import {Resvg} from '@resvg/resvg-js';
import {neutralSvg} from '../packages/v2/neutral-graphics.js';
const body=(svg:string)=>svg.slice(svg.indexOf('>')+1,svg.lastIndexOf('</svg>'));
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">${body(readFileSync('demo/assets/circle.svg','utf8'))}${body(neutralSvg('حكاية الأشكال','title'))}${body(neutralSvg('الدائرة الأولى','caption'))}<text x="540" y="120" text-anchor="middle" font-family="Arial,sans-serif" font-size="35" fill="white">SIMULATED WORKFLOW / NOT A PREMIERE RENDER</text></svg>`;
writeFileSync('demo/preview.png',new Resvg(svg,{fitTo:{mode:'width',value:540},font:{loadSystemFonts:true,defaultFontFamily:process.platform==='win32'?'Arial':'DejaVu Sans'}}).render().asPng());
console.log('Original synthetic preview rendered using installed system fonts.');
