import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const expected=JSON.parse(readFileSync('release-files.json','utf8')).files;
const deniedPath=/(^|\/)(?:style|styles|templates|fonts|analysis|logs|projects)(\/|$)|\.(?:mogrt|prproj|ttf|otf|woff2?|mp3|wav|mp4|zip)$/i;
const secret=/sk-[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const privateText=/(?:[A-Za-z]:[\\/](?:Users|PremiereAI|Video Editing)[\\/])|MCP\x20TEST|AI_TEST_\x30\x31|SECOND\x20TEST|NAJM_STYLE_\x53OURCE|brand-\x6dark\.webp/;
for(const file of expected){
 if(deniedPath.test(file))throw Error('Forbidden release category: '+file);
 const bytes=readFileSync(file);
 if(file.endsWith('.png')){
  let at=8;const chunks=[];while(at<bytes.length){const size=bytes.readUInt32BE(at),kind=bytes.toString('ascii',at+4,at+8);chunks.push(kind);if(!['IHDR','IDAT','IEND','sRGB','pHYs'].includes(kind))throw Error('Unexpected PNG metadata '+file+': '+kind);at+=size+12;}
 }else{
  const text=bytes.toString('utf8');
  if(secret.test(text)||privateText.test(text))throw Error('Sensitive text category in '+file);
  if(file.endsWith('.svg')&&/(?:https?:\/\/|file:)[^"\s]*\.(?:png|jpg|woff|ttf)|<image\b|@font-face/i.test(text))throw Error('External/bundled image or font in SVG '+file);
 }
}
if(existsSync('.git')){
 const actual=execFileSync('git',['--no-optional-locks','ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
 if(JSON.stringify(actual)!==JSON.stringify([...expected].sort()))throw Error('Git index does not match explicit release allowlist');
}
console.log('Release allowlist, tracked paths, text signatures, SVG references and PNG metadata passed ('+expected.length+' files). No font/native-template/client-media binaries included.');
