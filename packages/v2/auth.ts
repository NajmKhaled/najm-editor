import {randomBytes,timingSafeEqual} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

/** Local bootstrap only. Never embed this credential in release files or URLs. */
export function loadLocalToken(path=resolve('config','session-token')){
  if(existsSync(path)){const token=readFileSync(path,'utf8').trim();if(!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid local session credential; reinstall the panel');return token;}
  mkdirSync(dirname(path),{recursive:true});const token=randomBytes(32).toString('hex');
  try{writeFileSync(path,token,{flag:'wx',mode:0o600});return token}catch(error){if(existsSync(path))return loadLocalToken(path);throw error}
}
export function validToken(actual:unknown,expected:string){return typeof actual==='string'&&Buffer.byteLength(actual)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
export function trustedOrigin(origin:unknown){return origin===undefined||origin==='null'||origin==='file://' || origin==='http://127.0.0.1:47842';}
export function authorizedHttp(req:any,token:string){return trustedOrigin(req.headers.origin)&&validToken(req.headers.authorization,'Bearer '+token);}
