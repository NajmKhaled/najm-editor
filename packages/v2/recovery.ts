import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {DirectOperation,DirectPremiereBridge} from './direct-bridge.js';
import {jsonFile,saveJson} from './media.js';
import {sourceUnchanged} from './validate.js';
import {validatePreservedTimeline} from './source-audio.js';

const uncertain=(e:unknown)=>/disconnect|heartbeat|socket|HOST_OUTCOME_UNKNOWN|host timeout/i.test(String(e));
export async function recoverableCall(bridge:Pick<DirectPremiereBridge,'call'|'connected'|'acknowledgeReconciliation'>,op:DirectOperation,args:any,signal?:AbortSignal){
  signal?.throwIfAborted();
  try{return await bridge.call(op,args,180000)}catch(error){
    if(!uncertain(error))throw error;
    // A cancelled host call can still finish. Do not issue any further mutation.
    signal?.throwIfAborted();
    for(let i=0;i<20&&!bridge.connected;i++){await new Promise(r=>setTimeout(r,100));signal?.throwIfAborted()}
    if(!bridge.connected)throw Error('RECOVERY_REQUIRED: reconnect Premiere and resume this run; do not create another target');
    // CEP executes this read behind the outstanding evalScript. It is a completion barrier,
    // not evidence that a write failed. Read the affected sequence before idempotent replay.
    await bridge.call('getProjectState',{},30000);
    if(args.sequenceId)await bridge.call('readSequenceSnapshot',{sequenceId:args.sequenceId},30000);
    bridge.acknowledgeReconciliation();signal?.throwIfAborted();
    if(op==='createGeneratedSequence')throw Error('RECOVERY_REQUIRED: resolve persisted target intent before cloning again');
    if(!['buildRoughCutBatch','applyGraphicsBatch','saveProject','getSequenceSnapshot','readSequenceSnapshot','getProjectState','openGeneratedSequence'].includes(op))throw Error('RECOVERY_REQUIRED: verify the previous host operation before resuming');
    return bridge.call(op,args,180000);
  }
}

export async function ensureTarget(input:{bridge:Pick<DirectPremiereBridge,'call'|'connected'|'acknowledgeReconciliation'>;dir:string;runId:string;sourceId:string;sourceSnapshot:any;planKey:string;preserveTimeline:boolean;test?:boolean;signal?:AbortSignal}){
  const {bridge,dir,runId,sourceId,sourceSnapshot,planKey,preserveTimeline,signal}=input;
  signal?.throwIfAborted();
  const state=await bridge.call('getProjectState',{},30000);
  bridge.acknowledgeReconciliation();
  sourceUnchanged(sourceSnapshot,await bridge.call('getSequenceSnapshot',{sequenceId:sourceId},30000));
  const intentPath=join(dir,'TARGET_INTENT.json'),receiptPath=join(dir,'TARGET_RECEIPT.json'),targetPath=join(dir,'TARGET.json');
  let intent=jsonFile<any>(intentPath);
  if(intent&&(intent.runId!==runId||intent.sourceSequenceId!==sourceId||intent.planKey!==planKey||intent.projectPath!==state.projectPath))throw Error('RECOVERY_REQUIRED: saved target intent differs; preserve the existing target and start a separately reviewed run');
  if(!intent){const names=new Set(state.sequences.map((s:any)=>s.name));let i=1,name='';do{name=(input.test?'NAJM_TEST_':'NAJM_EDIT_')+String(i++).padStart(2,'0')}while(names.has(name));intent={runId,sourceSequenceId:sourceId,projectPath:state.projectPath,name,planKey,preserveTimeline};saveJson(intentPath,intent)}
  const matches=state.sequences.filter((s:any)=>s.name===intent.name),receipt=jsonFile<any>(receiptPath);
  if(matches.length>1)throw Error('RECOVERY_REQUIRED: multiple targets match the saved intent; no timeline changed');
  if(matches.length){
    if(!receipt||receipt.runId!==runId||receipt.sequenceId!==matches[0].id||receipt.sourceSequenceId!==sourceId||receipt.projectPath!==state.projectPath||!receipt.initialized)throw Error('RECOVERY_REQUIRED: target ownership or initialization is ambiguous; no second target created');
    const snapshot=await bridge.call('readSequenceSnapshot',{sequenceId:receipt.sequenceId},30000);
    if(preserveTimeline)validatePreservedTimeline(sourceSnapshot,snapshot,true);
    const target={sequenceId:receipt.sequenceId,name:intent.name,sourceSequenceId:sourceId,planKey,preserveTimeline,snapshot};saveJson(targetPath,target);return target;
  }
  if(receipt||existsSync(targetPath))throw Error('RECOVERY_REQUIRED: saved target is missing or renamed; refusing a replacement clone');
  signal?.throwIfAborted();
  let target:any;
  try{target=await bridge.call('createGeneratedSequence',{...intent,targetReceiptPath:receiptPath,operationKey:runId+'-target'},180000)}catch(error){
    // Never blindly retry a clone. A later explicit Resume resolves the receipt.
    if(uncertain(error))throw Error('RECOVERY_REQUIRED: target creation outcome unknown; reconnect and Resume to read the saved receipt');throw error;
  }
  if(target.sequenceId===sourceId)throw Error('Target equals protected source');
  const durable=JSON.parse(readFileSync(receiptPath,'utf8'));
  if(!durable.initialized||durable.sequenceId!==target.sequenceId||durable.runId!==runId)throw Error('RECOVERY_REQUIRED: host did not persist target ownership');
  if(preserveTimeline)validatePreservedTimeline(sourceSnapshot,target.snapshot,true);
  target.planKey=planKey;saveJson(targetPath,target);return target;
}
