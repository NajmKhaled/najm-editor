import {createHash} from 'node:crypto';import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {runDemo,texts} from '../../demo/run.js';
import {analyzeReferenceSnapshot} from './reference-learning.js';
import {ensureTarget,recoverableCall} from './recovery.js';
import {prepareArabicGraphics,validateEmbeddedGraphics} from './graphics.js';
import {sourceUnchanged,validateRough} from './validate.js';
import {saveJson,jsonFile} from './media.js';
import type {DirectPremiereBridge} from './direct-bridge.js';

/** Explicitly invoked synthetic acceptance path; never selects private projects by default. */
export async function applySyntheticDemo(bridge:DirectPremiereBridge,signal?:AbortSignal){
 const state=await bridge.call('getProjectState'),find=(name:string)=>{const rows=state.sequences.filter((s:any)=>s.name===name);if(rows.length!==1)throw Error('Create exactly one '+name+' sequence per docs/PREMIERE_ACCEPTANCE.md');return rows[0]};
 const source=find('Synthetic shapes source'),reference=find('Synthetic reference'),snapshot=await bridge.call('getSequenceSnapshot',{sequenceId:source.id}),ref=await bridge.call('getReferenceSnapshot',{sequenceId:reference.id});
 const mediaRoot=resolve('demo/output/media'),clips=[...snapshot.videoTracks,...snapshot.audioTracks,...ref.videoTracks,...ref.audioTracks].flatMap((t:any)=>t.clips||[]);
 if(!state.projectPath||!clips.length||clips.some((c:any)=>!c.mediaPath||relative(mediaRoot,resolve(c.mediaPath)).startsWith('..')||!['circle.mp4','square.mp4','triangle.mp4','silence.wav'].includes(relative(mediaRoot,resolve(c.mediaPath)))))throw Error('SYNTHETIC_ONLY: source and reference must contain only this checkout\'s generated demo media');
 const report=analyzeReferenceSnapshot(ref,'synthetic-project',{caption:true,title:true}),pace=report.proposed?.targetShotDurationMs;
 if(!pace||![1000,2000].includes(pace))throw Error('Synthetic reference needs a 1 or 2 second measured shot median');
 const runId=createHash('sha256').update(JSON.stringify([state.projectPath,source.id,reference.id])).digest('hex').slice(0,24),dir=resolve('projects/v2/synthetic-'+runId);mkdirSync(dir,{recursive:true});
 for(const [name,current] of [['SOURCE_BASELINE.json',snapshot],['REFERENCE_BASELINE.json',ref]] as const){const file=join(dir,name),prior=jsonFile<any>(file);if(prior)sourceUnchanged(prior,current);else saveJson(file,current)}
 await runDemo(join(dir,'plan'),pace);const saved=JSON.parse(readFileSync(join(dir,'plan/plan.json'),'utf8')),plan=saved.plan;plan.shots=plan.shots.map((s:any)=>({...s,source_media:join(mediaRoot,s.source_media.split('/').at(-1).replace('.svg','.mp4'))}));
 const audio=join(mediaRoot,'silence.wav');if(!existsSync(audio)||plan.shots.some((s:any)=>!existsSync(s.source_media)))throw Error('Run npm run demo:media first');
 const target=await ensureTarget({bridge,dir,runId,sourceId:source.id,sourceSnapshot:snapshot,planKey:'synthetic-'+pace,preserveTimeline:false,signal});
 const base={runId,sequenceId:target.sequenceId,sourceSequenceId:source.id,targetReceiptPath:join(dir,'TARGET_RECEIPT.json')};
 for(let i=0;i<plan.shots.length;i+=8)await recoverableCall(bridge,'buildRoughCutBatch',{...base,cleanNarrationPath:audio,shots:plan.shots,sourceAudio:[],batchStart:i,batchEnd:i+8},signal);
 const prepared=await prepareArabicGraphics(dir,texts.map((text,i)=>({text,start:i*4,end:(i+1)*4})),{text:plan.title_ar,start:0,end:2.5},signal);
 const graphics=await recoverableCall(bridge,'applyGraphicsBatch',{...base,...prepared,titleTrackIndex:snapshot.videoTracks.length,captionTrackIndex:snapshot.videoTracks.length+1},signal);
 const final=await bridge.call('readSequenceSnapshot',{sequenceId:target.sequenceId});validateRough(final,plan,audio,12,[]);validateEmbeddedGraphics(final,prepared,graphics);sourceUnchanged(snapshot,await bridge.call('getSequenceSnapshot',{sequenceId:source.id}));sourceUnchanged(ref,await bridge.call('getReferenceSnapshot',{sequenceId:reference.id}));
 await recoverableCall(bridge,'saveProject',{},signal);
 const result={structuralCompletion:true,visualAcceptance:'PENDING_HUMAN_REVIEW',inference:'FIXTURE',targetSequenceId:target.sequenceId,shotCount:plan.shots.length,sourcePreserved:true,referencePreserved:true};saveJson(join(dir,'SYNTHETIC_ACCEPTANCE.json'),result);return result;
}
