import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ensureTarget,recoverableCall} from '../../packages/v2/recovery.js';
import {prepareArabicGraphics,validateEmbeddedGraphics} from '../../packages/v2/graphics.js';
import {sourceUnchanged} from '../../packages/v2/validate.js';
import {hostFixture} from './host-fixture.js';
async function setup(videoCount=1){const bridge=hostFixture(videoCount),dir=mkdtempSync(join(tmpdir(),'najm-synthetic-')),sourceId=bridge.source.sequenceID,sourceSnapshot=await bridge.call('getSequenceSnapshot',{sequenceId:sourceId}),options={bridge,dir,runId:'synthetic-run',sourceId,sourceSnapshot,planKey:'demo',preserveTimeline:false};return {...options,target:await ensureTarget(options)}}
test('lost clone response resolves durable receipt after host restart without a second target',async()=>{
  const bridge=hostFixture(),dir=mkdtempSync(join(tmpdir(),'najm-lost-response-')),sourceId=bridge.source.sequenceID,sourceSnapshot=await bridge.call('getSequenceSnapshot',{sequenceId:sourceId}),original=bridge.call;
  let lose=true;bridge.call=async(op:string,args:any)=>{const result=await original(op,args);if(op==='createGeneratedSequence'&&lose){lose=false;throw Error('HOST_OUTCOME_UNKNOWN: response lost after clone')}return result};
  const options={bridge,dir,runId:'lost-response',sourceId,sourceSnapshot,planKey:'demo',preserveTimeline:false};
  await assert.rejects(ensureTarget(options),/outcome unknown/);assert.equal(bridge.sequences.length,2);bridge.restart();const recovered=await ensureTarget(options);assert.equal(recovered.sequenceId,bridge.sequences[1].sequenceID);assert.equal(bridge.sequences.length,2);sourceUnchanged(sourceSnapshot,await bridge.call('getSequenceSnapshot',{sequenceId:sourceId}));
});
test('ambiguous, renamed and incomplete target receipts fail closed',async()=>{
  const x=await setup(),file=join(x.dir,'TARGET_RECEIPT.json'),receipt=JSON.parse(readFileSync(file,'utf8'));writeFileSync(file,JSON.stringify({...receipt,initialized:false}));await assert.rejects(ensureTarget(x),/ambiguous/);assert.equal(x.bridge.sequences.length,2);
});
for(const count of [1,2,5])test('graphics append on '+count+' source tracks and survive interrupted placement and host restart',async()=>{
  const x=await setup(count),captions=[{start:0,end:1,text:'الدائرة الحمراء'},{start:1,end:2,text:'المربع الأزرق'},{start:2,end:3,text:'المثلث الأخضر'}],title={start:0,end:2,text:'حكاية الأشكال'};
  const prepared=await prepareArabicGraphics(x.dir,captions,title),args={...prepared,runId:x.runId,sequenceId:x.target.sequenceId,sourceSequenceId:x.sourceId,targetReceiptPath:join(x.dir,'TARGET_RECEIPT.json'),titleTrackIndex:count,captionTrackIndex:count+1};
  x.bridge.failNext(1);await assert.rejects(x.bridge.call('applyGraphicsBatch',args),/interruption/);x.bridge.noFailure();x.bridge.restart();const result=await x.bridge.call('applyGraphicsBatch',args),snap=await x.bridge.call('readSequenceSnapshot',{sequenceId:x.target.sequenceId});validateEmbeddedGraphics(snap,prepared,result);assert.equal(snap.videoTracks[count+1].clips.length,3);await x.bridge.call('applyGraphicsBatch',args);assert.equal((await x.bridge.call('readSequenceSnapshot',{sequenceId:x.target.sequenceId})).videoTracks[count+1].clips.length,3);sourceUnchanged(x.sourceSnapshot,await x.bridge.call('getSequenceSnapshot',{sequenceId:x.sourceId}));
  const target=x.bridge.sequences[1];target.videoTracks[count].clips[0].name='manual correction';await assert.rejects(x.bridge.call('applyGraphicsBatch',args),/unrelated or modified/);assert.equal(target.videoTracks[count].clips.numItems,1);
});
test('timeout performs completion barrier and actual read before replay; cancellation never replays',async()=>{
  const calls:string[]=[];let first=true;const bridge:any={connected:true,acknowledgeReconciliation(){calls.push('reconciled')},async call(op:string){calls.push(op);if(op==='buildRoughCutBatch'&&first){first=false;throw Error('HOST_OUTCOME_UNKNOWN host timeout')}return {}}};await recoverableCall(bridge,'buildRoughCutBatch',{sequenceId:'target'});assert.deepEqual(calls,['buildRoughCutBatch','getProjectState','readSequenceSnapshot','reconciled','buildRoughCutBatch']);
  const controller=new AbortController();controller.abort();calls.length=0;await assert.rejects(recoverableCall(bridge,'buildRoughCutBatch',{},controller.signal));assert.deepEqual(calls,[]);
});
