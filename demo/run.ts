import {EditingAgentStore} from '../packages/v2/agent-store.js';
import {proposeReferenceRules,snapshotHash} from '../packages/v2/training-studio.js';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {analyzeReferenceSnapshot} from '../packages/v2/reference-learning.js';
import {createCandidates,createVisualSlots} from '../packages/v2/candidate-plan.js';
import {loadAndPreflightVisualPlan} from '../packages/v2/visual-plan-cache.js';
import {buildVisualCall2Input} from '../packages/v2/visual-input.js';
import {FixtureModelProvider} from '../packages/v2/fixture-model.js';
import {neutralGraphic} from '../packages/v2/neutral-graphics.js';
import type {StoryPlan} from '../packages/v2/workflow-types.js';

export const texts=['الدائرة الأولى','المربع الثاني','المثلث الثالث'];
export function reference(seconds:number){return {id:'synthetic-reference',name:'Synthetic reference',duration:12,sequenceFps:30,width:1080,height:1920,videoTracks:[{index:0,clips:Array.from({length:12/seconds},(_,i)=>({id:'ref-'+i,mediaPath:'synthetic',start:i*seconds,end:(i+1)*seconds,sourceIn:0,sourceOut:seconds}))}],audioTracks:[]}}
export async function runDemo(output=resolve('demo','output'),pacing=2000){
  mkdirSync(output,{recursive:true});
  const shapes=['<circle cx="540" cy="870" r="160" fill="#ef4444"/>','<rect x="380" y="710" width="320" height="320" fill="#3b82f6"/>','<path d="M540 670L740 1070H340Z" fill="#22c55e"/>'];
  const media=shapes.map((shape,i)=>{const file=resolve('demo','assets',['circle','square','triangle'][i]+'.svg');return {mediaPath:file,filename:['circle','square','triangle'][i],duration:12,width:1080,height:1920,frameRate:'30/1',candidate_windows:Array.from({length:6},(_,j)=>({start:0,end:12,anchor:1+j*2,contactSheetIndex:j}))}});
  const ref=reference(pacing/1000),refHash=snapshotHash(ref),sourceHash=snapshotHash(media.map(m=>({...m,mediaPath:'demo/assets/'+basename(m.mediaPath)})));
  const report=analyzeReferenceSnapshot(ref,'synthetic-project',{caption:true,title:true});
  const story:StoryPlan={corrected_transcript:texts.join(' '),story_beats:texts.map((text,i)=>({id:'beat-'+i,summary:text,start:i*4,end:(i+1)*4})),keep_segments:texts.map((text,i)=>({id:'speech-'+i,source_start:i*4,source_end:(i+1)*4,corrected_text:text})),remove_segments:[]};
  const mapping=texts.map((text,i)=>({sourceStart:i*4,sourceEnd:(i+1)*4,cleanStart:i*4,cleanEnd:(i+1)*4,text}));
  const candidates=createCandidates(media),slots=createVisualSlots(story,mapping,12,candidates,30);
  const store=new EditingAgentStore(join(output,'agents')),draft=store.save({name:pacing===1000?'Tight':'Measured',description:'Original generic sample agent',instructions:'Use only the supplied current shape footage',draft:true}),inferred=proposeReferenceRules(report),rules=inferred.rules.map(r=>({...r,status:'CONFIRMED' as const}));
  const saved=store.saveLearned(draft.id,draft.version,{schemaVersion:1,sessionId:'synthetic-learning',learnedAt:new Date().toISOString(),verification:'LEARNED_ONLY',rules,capabilityLimitations:report.unsupported.map(x=>x.property),requirements:{captionTemplateHash:'f'.repeat(64),titleTemplateHash:'f'.repeat(64)},knowledge:{schemaVersion:1,provenance:{referenceFingerprint:report.sourceFingerprint,observedAt:report.observedAt},observed:{shotCount:report.observed.shotCount,cuts:report.observed.cuts,audioTrackCount:0,graphicTextClips:0},inferred:{styleMemory:report.styleMemory,audioStatus:'UNAVAILABLE'}}});
  const agent=store.preferences(saved.id);
  const input=buildVisualCall2Input(story.corrected_transcript,slots,candidates,media,'', {sequenceName:'Synthetic shapes source',assets:[]},[],agent);
  const provider=new FixtureModelProvider();
  const result=await loadAndPreflightVisualPlan({dir:output,visualKey:'synthetic-'+pacing,media,story,cleanMapping:mapping,duration:12,sequenceFps:30,loadModel:async()=>provider.runVisualEditPlan(input,[],output)});
  const plan={...result.normalized,shots:result.normalized.shots.map(s=>({...s,source_media:'demo/assets/'+['circle','square','triangle'][media.findIndex(m=>m.mediaPath===s.source_media)]+'.svg'}))};
  const summary={inference:'DETERMINISTIC_FIXTURE',timingEvidence:'SYNTHETIC',referenceTargetMs:report.proposed!.targetShotDurationMs,shotCount:plan.shots.length,duration:12,sourceFramesReused:false,sourceFingerprint:sourceHash,referencePreserved:snapshotHash(ref)===refHash,sourcePreserved:snapshotHash(media.map(m=>({...m,mediaPath:'demo/assets/'+basename(m.mediaPath)})))===sourceHash,agent:{name:saved.name,version:saved.version,rules:rules.map(r=>({kind:r.kind,value:r.value,support:r.support,status:r.status}))},validation:result.manifest.state,premiereVerification:'NOT_RUN'};
  writeFileSync(join(output,'plan.json'),JSON.stringify({summary,plan},null,2)+'\n');
  const bars=plan.shots.map((s,i)=>`<rect x="${80+s.timeline_start*70}" y="330" width="${(s.timeline_end-s.timeline_start)*70-2}" height="80" rx="3" fill="${['#b59ae8','#80efd2','#7c87cf'][Math.floor(s.timeline_start/4)]}"/><text x="${85+s.timeline_start*70}" y="375" fill="white" font-family="sans-serif" font-size="15">${i+1}</text>`).join('');
  writeFileSync(join(output,'plan.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="520"><rect width="1000" height="520" fill="#101827"/><g fill="white" font-family="sans-serif"><text x="80" y="90" font-size="34">NajmEditor | Synthetic shapes</text><text x="80" y="145" font-size="22">Fixture inference - ${pacing} ms reference pace - ${plan.shots.length} validated shots</text><text x="80" y="200" font-size="19">Reference statistics → saved rule → V2 candidate planner → validator</text><text x="80" y="465" font-size="18">0 s                                              4 s                                           8 s                                           12 s</text></g>${bars}</svg>`);
  return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const slow=await runDemo(resolve('demo/output/slow'),2000),fast=await runDemo(resolve('demo/output/fast'),1000);
  if(slow.shotCount!==6||fast.shotCount!==12)throw Error('Reference pacing did not change the validated plan');
  console.log(JSON.stringify({provider:'fixture',networkUsed:false,slow,fast,output:'demo/output/'},null,2));
}
