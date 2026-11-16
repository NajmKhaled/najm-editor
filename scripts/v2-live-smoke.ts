import {readFileSync} from 'node:fs';
const token=readFileSync('config/session-token','utf8').trim();
const response=await fetch('http://127.0.0.1:47842/v2/health',{headers:{Authorization:'Bearer '+token}});
if(!response.ok)throw Error('Authenticated V2 health failed: '+response.status);
const h:any=await response.json();console.log(JSON.stringify({engine:h.engine,directConnected:h.directConnected,buildReady:h.buildReady,sourceReady:h.sourceReady}));
console.log('For timeline writes use the synthetic demo in docs/PREMIERE_ACCEPTANCE.md with current prepareArabicGraphics output.');
