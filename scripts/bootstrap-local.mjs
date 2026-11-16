import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
mkdirSync('config',{recursive:true});const file='config/session-token';
if(!existsSync(file))writeFileSync(file,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
if(!/^[a-f0-9]{64}$/.test(readFileSync(file,'utf8').trim()))throw Error('Invalid local session credential');
console.log('Local session bootstrap ready. Credential remains outside public configuration.');
