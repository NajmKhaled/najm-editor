import test from 'node:test';import assert from 'node:assert/strict';
import {once} from 'node:events';import WebSocket from 'ws';
import {DirectPremiereBridge} from '../../packages/v2/direct-bridge.js';
import {V2Service} from '../../services/v2/service.js';
import {validToken} from '../../packages/v2/auth.js';
const token='a'.repeat(64);
test('private HTTP reads and writes require credentials, including opaque browser origins',async()=>{
  const service:any=Object.create(V2Service.prototype);service.authToken=token;service.sourceState=async()=>({sequences:[],activeSequence:null});
  const bridge=new DirectPremiereBridge(0,(req,res)=>void service.handle(req,res),'build',token);
  try{while(!bridge.port)await new Promise(r=>setTimeout(r,5));const url='http://127.0.0.1:'+bridge.port+'/v2/source-state';
    assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{Origin:'null'}})).status,401);
    assert.equal((await fetch(url,{method:'POST'})).status,401);
    assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+token}})).status,200);
    assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+token,Origin:'https://untrusted.invalid'}})).status,403);
    assert.equal(validToken('é'.repeat(64),token),false);
  }finally{await bridge.close()}
});
test('authenticated CEP protocol connects; missing credential and stale build receive no host session',async()=>{
 const bridge=new DirectPremiereBridge(0,undefined,'build',token);while(!bridge.port)await new Promise(r=>setTimeout(r,5));const url='ws://127.0.0.1:'+bridge.port+'/premiere-direct?buildId=';
 try{for(const [build,protocols] of [['build',['najm-v2']],['stale',['najm-v2',token]]] as const){const ws=new WebSocket(url+build,[...protocols]);const [code]=await once(ws,'close');assert.equal(code,1008);assert.equal(bridge.connected,false)}const ws=new WebSocket(url+'build',['najm-v2',token],{origin:'null'});const [raw]=await once(ws,'message');assert.equal(JSON.parse(String(raw)).type,'hello');assert.equal(bridge.connected,true);ws.close();await once(ws,'close');}finally{await bridge.close()}
});
