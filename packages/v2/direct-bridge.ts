import {createServer, type Server, type RequestListener} from 'node:http';
import {loadLocalToken,trustedOrigin,validToken} from './auth.js';
import {WebSocketServer, WebSocket} from 'ws';

export type DirectOperation='health'|'getProjectState'|'getActiveSequenceState'|'getSequenceSnapshot'|'getReferenceSnapshot'|'activateSourceSequence'|'openGeneratedSequence'|'createSourceAssembly'|'createGeneratedSequence'|'buildRoughCutBatch'|'readSequenceSnapshot'|'inspectGraphicAt'|'exportGeneratedFrame'|'applyOverlayBatch'|'applyGraphicsBatch'|'saveProject';
type Pending={resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout;operation:DirectOperation};

/** The CEP panel owns the Premiere scripting context. Only one host mutation runs at a time. */
export class DirectPremiereBridge {
  private server:Server;
  private wsServer:WebSocketServer;
  private socket?:WebSocket;
  private pending=new Map<number,Pending>();
  private nextId=1;
  private lastPong=0;
  private heartbeat:NodeJS.Timeout;
  private uncertain=false;
  acknowledgeReconciliation(){this.uncertain=false}
  private mutationTail:Promise<unknown>=Promise.resolve();
  constructor(port=47842,handler?:RequestListener,private expectedBuildId?:string,private authToken=loadLocalToken()){
    this.server=createServer(handler||((_req,res)=>{res.writeHead(404).end()}));
    this.wsServer=new WebSocketServer({server:this.server,path:'/premiere-direct',maxPayload:32*1024*1024});
    this.wsServer.on('connection',(socket,request)=>{
      const protocols=String(request.headers['sec-websocket-protocol']||'').split(',').map(x=>x.trim());
      if(!trustedOrigin(request.headers.origin)||!validToken(protocols[1],this.authToken)){socket.close(1008,'Unauthorized panel');return}
      const panelBuildId=new URL(request.url||'/', 'ws://127.0.0.1').searchParams.get('buildId');
      if(this.expectedBuildId&&panelBuildId!==this.expectedBuildId){console.warn('Premiere Direct rejected panel build',String(panelBuildId||'missing').slice(0,12),'expected',this.expectedBuildId.slice(0,12));socket.close(1008,'Panel build mismatch');return}
      const origin=request.headers.origin||'';
      if(origin&&!/^file:|^null$|^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin)){console.warn('Premiere Direct rejected origin',origin);socket.close(1008,'Untrusted origin');return}
      this.disconnect(Error('Premiere panel replaced the direct connection'));
      this.socket=socket;this.lastPong=Date.now();
      console.log('Premiere Direct panel connected');
      socket.on('message',raw=>this.onMessage(String(raw)));
      socket.on('pong',()=>{this.lastPong=Date.now()});
      socket.on('close',(code,reason)=>{if(this.socket===socket){console.warn('Premiere Direct panel disconnected',code,String(reason).slice(0,80));this.disconnect(Error('Premiere Direct disconnected'))}});
      socket.on('error',error=>{if(this.socket===socket){console.warn('Premiere Direct socket error',String(error).slice(0,160));this.disconnect(Error('Premiere Direct socket error'))}});
      socket.send(JSON.stringify({type:'hello',version:2}));
    });
    this.server.listen(port,'127.0.0.1');
    this.heartbeat=setInterval(()=>{const socket=this.socket;if(!socket||socket.readyState!==WebSocket.OPEN)return;if(Date.now()-this.lastPong>7000&&this.pending.size===0){socket.terminate();this.disconnect(Error('Premiere Direct heartbeat lost'));return}socket.ping()},2000);
  }
  get connected(){return !!this.socket&&this.socket.readyState===WebSocket.OPEN&&(this.pending.size>0||Date.now()-this.lastPong<7000)}
  get port(){const address=this.server.address();return address&&typeof address==='object'?address.port:0}
  private disconnect(error:Error){const socket=this.socket;this.socket=undefined;if(socket&&socket.readyState===WebSocket.OPEN)socket.close();for(const [id,p] of this.pending){if(this.isMutation(p.operation))this.uncertain=true;clearTimeout(p.timer);p.reject(error);this.pending.delete(id)}}
  private onMessage(raw:string){let message:any;try{message=JSON.parse(raw)}catch{return}if(message.type==='heartbeat'){this.lastPong=Date.now();return}if(message.type!=='result'||!Number.isInteger(message.id))return;const p=this.pending.get(message.id);if(!p)return;this.lastPong=Date.now();this.pending.delete(message.id);clearTimeout(p.timer);message.ok?p.resolve(message.result):p.reject(Error(`${p.operation}: ${String(message.error||'Premiere host error')}`))}
  private isMutation(op:string){return ['activateSourceSequence','openGeneratedSequence','createSourceAssembly','createGeneratedSequence','buildRoughCutBatch','exportGeneratedFrame','applyGraphicsBatch','applyOverlayBatch','saveProject'].includes(op)}
  call(operation:DirectOperation,args:any={},timeoutMs=120000):Promise<any>{
    const execute=()=>new Promise<any>((resolve,reject)=>{
      if(this.isMutation(operation)&&this.uncertain)return reject(Error('HOST_OUTCOME_UNKNOWN: reconcile the actual Premiere state before another write'));
      if(!this.connected)return reject(Error(`Premiere Direct disconnected during ${operation}`));
      const id=this.nextId++,timer=setTimeout(()=>{this.pending.delete(id);if(this.isMutation(operation))this.uncertain=true;reject(Error(`${operation}: HOST_OUTCOME_UNKNOWN host timeout after ${timeoutMs} ms`))},timeoutMs);
      this.pending.set(id,{resolve,reject,timer,operation});
      try{this.socket!.send(JSON.stringify({type:'request',id,operation,args}))}catch(error){clearTimeout(timer);this.pending.delete(id);reject(Error(`${operation}: ${String(error)}`))}
    });
    const mutation=['activateSourceSequence','openGeneratedSequence','createSourceAssembly','createGeneratedSequence','buildRoughCutBatch','exportGeneratedFrame','applyGraphicsBatch','applyOverlayBatch','saveProject'].includes(operation);
    if(!mutation)return execute();
    const task=this.mutationTail.then(execute);this.mutationTail=task.catch(()=>{});return task;
  }
  async close(){clearInterval(this.heartbeat);this.wsServer.close();const socket=this.socket;this.socket=undefined;socket?.terminate();for(const [id,p] of this.pending){clearTimeout(p.timer);p.reject(Error('Premiere Direct closed'));this.pending.delete(id)}this.server.closeAllConnections();await new Promise<void>(resolve=>this.server.close(()=>resolve()))}
}
