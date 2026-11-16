import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {analyzeReferenceSnapshot} from './reference-learning.js';

export type TrainingStep='CLARIFY'|'TEST_PREPARED'|'TEST_RUNNING'|'REVIEW_TEST'|'UPDATE_REVIEW'|'RETEST_PREPARED'|'READY_TO_APPROVE'|'APPROVED';
export type RuleKind='shot_pacing'|'opening_pacing'|'graphic_rhythm'|'audio_layers'|'editor_instruction';
export type RuleStatus='PROPOSED'|'CONFIRMED'|'REJECTED';
export interface TrainingRule {id:string;kind:RuleKind;summary:string;value:number|string;scope:'general'|'reference_only';confidence:'low'|'medium'|'high';evidence:string;support:'EXECUTABLE'|'ADVISORY'|'UNAVAILABLE';status:RuleStatus;editorReason?:string}
export interface TrainingQuestion {id:string;ruleId:string;question:string;answered?:string}
export interface TimelineChange {kind:'added'|'removed'|'moved'|'trimmed'|'source_moment'|'graphic_text'|'components'|'order';trackType:'video'|'audio';track:number;clip:string;before?:unknown;after?:unknown}
export interface CorrectionRetest {ruleId:string;targetMs:number;priorRunId:string;priorObservedMs:number|null;currentObservedMs:number|null;priorErrorMs:number|null;currentErrorMs:number|null;status:'IMPROVED'|'UNCHANGED'|'REGRESSED'|'UNAVAILABLE'}
export interface TrainingCycle {runId:string;agentVersion:number;section:{start:number;end:number};baselineHash:string;baselineFile:string;targetSequenceId:string;targetName:string;observedShotMedianMs:number|null;ruleOutcomes?:{ruleId:string;targetMs:number;observedMs:number|null;status:'UNAVAILABLE'|'OBSERVED_WITHIN_TOLERANCE'|'OBSERVED_OUTSIDE_TOLERANCE'}[];correctionRetest?:CorrectionRetest;changes?:TimelineChange[];correctionHash?:string;correctionFile?:string;correctionRuleId?:string;editorReason?:string;confirmed?:boolean}
export interface TrainingSession {schemaVersion:1;id:string;createdAt:string;updatedAt:string;agentId:string;agentVersion:number;projectPath:string;referenceSequenceId:string;referenceFingerprint:string;step:TrainingStep;progress:{label:string;completed:string[]};referenceReport:any;rules:TrainingRule[];questions:TrainingQuestion[];cycles:TrainingCycle[];pendingTest?:{token:string;sourceSequenceId:string;sourceFingerprint:string;section:{start:number;end:number};agentVersion:number;projectPath:string};history:{at:string;event:string;detail:string}[]}

/** The newest confirmed executable rule wins; reference-specific and advisory rules never drive an edit. */
export function executablePacingRule(rules:TrainingRule[]|undefined):TrainingRule|undefined{return [...(rules||[])].reverse().find(rule=>rule.kind==='shot_pacing'&&rule.status==='CONFIRMED'&&rule.scope==='general'&&rule.support==='EXECUTABLE'&&Number.isInteger(rule.value)&&Number(rule.value)>=500&&Number(rule.value)<=10000)}

/** Compare a retest only with the TEST whose editor correction produced its executable pace rule. */
export function evaluateCorrectionRetest(rules:TrainingRule[],cycles:TrainingCycle[],observedMs:number|null):CorrectionRetest|undefined{
  const rule=executablePacingRule(rules);
  if(!rule?.id.startsWith('correction_'))return undefined;
  const prior=[...cycles].reverse().find(cycle=>cycle.confirmed&&cycle.correctionRuleId===rule.id);
  if(!prior)return undefined;
  const targetMs=Number(rule.value),priorObservedMs=prior.observedShotMedianMs;
  const priorErrorMs=priorObservedMs===null?null:Math.abs(priorObservedMs-targetMs),currentErrorMs=observedMs===null?null:Math.abs(observedMs-targetMs);
  const status=priorErrorMs===null||currentErrorMs===null?'UNAVAILABLE':currentErrorMs<priorErrorMs?'IMPROVED':currentErrorMs>priorErrorMs?'REGRESSED':'UNCHANGED';
  return {ruleId:rule.id,targetMs,priorRunId:prior.runId,priorObservedMs,currentObservedMs:observedMs,priorErrorMs,currentErrorMs,status};
}

export const snapshotHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clipIdentity=(clip:any)=>String(clip?.id||'');
const sourceIdentity=(clip:any)=>String(clip?.projectItemId||clip?.mediaPath||clip?.name||'');
const textIdentity=(clip:any)=>JSON.stringify(clip?.graphic||[]);
const componentIdentity=(clip:any)=>JSON.stringify(clip?.components||clip?.componentNames||[]);
const close=(a:any,b:any)=>a===undefined&&b===undefined||Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<=.02;
const trackRows=(snapshot:any,type:'video'|'audio')=>(type==='video'?snapshot.videoTracks:snapshot.audioTracks)||[];
/** Compare immutable pre-correction evidence with the current live TEST readback. */
export function diffTimelines(before:any,after:any):TimelineChange[]{
  if(!before||!after||before.id!==after.id)throw Error('TEST sequence identity changed; correction comparison stopped');
  const changes:TimelineChange[]=[];
  for(const type of ['video','audio'] as const){
    const previous=trackRows(before,type),current=trackRows(after,type),tracks=new Set<number>([...previous,...current].map((row:any)=>Number(row.index)));
    for(const track of [...tracks].sort((a,b)=>a-b)){
      const old=(previous.find((row:any)=>Number(row.index)===track)?.clips||[]) as any[],now=(current.find((row:any)=>Number(row.index)===track)?.clips||[]) as any[];
      const oldById=new Map(old.map(clip=>[clipIdentity(clip),clip])),newById=new Map(now.map(clip=>[clipIdentity(clip),clip]));
      for(const clip of old){const id=clipIdentity(clip),next=newById.get(id);if(!next){changes.push({kind:'removed',trackType:type,track,clip:id,before:{name:clip.name,start:clip.start,end:clip.end,source:sourceIdentity(clip)}});continue}
        if(!close(clip.start,next.start))changes.push({kind:'moved',trackType:type,track,clip:id,before:clip.start,after:next.start});
        if(!close(clip.end-clip.start,next.end-next.start))changes.push({kind:'trimmed',trackType:type,track,clip:id,before:clip.end-clip.start,after:next.end-next.start});
        if(sourceIdentity(clip)!==sourceIdentity(next)||!close(clip.sourceIn,next.sourceIn)||!close(clip.sourceOut,next.sourceOut))changes.push({kind:'source_moment',trackType:type,track,clip:id,before:{source:sourceIdentity(clip),in:clip.sourceIn,out:clip.sourceOut},after:{source:sourceIdentity(next),in:next.sourceIn,out:next.sourceOut}});
        if(textIdentity(clip)!==textIdentity(next))changes.push({kind:'graphic_text',trackType:type,track,clip:id,before:clip.graphic||[],after:next.graphic||[]});
        if(componentIdentity(clip)!==componentIdentity(next))changes.push({kind:'components',trackType:type,track,clip:id,before:clip.components||clip.componentNames||[],after:next.components||next.componentNames||[]});
      }
      for(const clip of now)if(!oldById.has(clipIdentity(clip)))changes.push({kind:'added',trackType:type,track,clip:clipIdentity(clip),after:{name:clip.name,start:clip.start,end:clip.end,source:sourceIdentity(clip)}});
      const sharedOld=old.filter(clip=>newById.has(clipIdentity(clip))).map(clipIdentity),sharedNew=now.filter(clip=>oldById.has(clipIdentity(clip))).map(clipIdentity);
      if(sharedOld.join('|')!==sharedNew.join('|'))changes.push({kind:'order',trackType:type,track,clip:'track',before:sharedOld,after:sharedNew});
    }
  }
  return changes;
}

export function proposeReferenceRules(report:any):{rules:TrainingRule[];questions:TrainingQuestion[]}{
  const memory=report?.styleMemory;if(!memory)throw Error('Reference has too little verified footage for style learning');
  const rules:TrainingRule[]=[{id:'pace',kind:'shot_pacing',summary:'Use the observed visual shot pace as a flexible guide',value:report.proposed.targetShotDurationMs,scope:'general',confidence:report.proposed.confidence,evidence:`DERIVED from ${report.observed.shotCount} primary video clips; median ${report.observed.shotDurationMs.median} ms; system inferred`,support:'EXECUTABLE',status:'CONFIRMED'}];
  if(memory.pacing.openingFiveSecondsMedianMs!==null)rules.push({id:'opening',kind:'opening_pacing',summary:'Consider the observed opening pace when the new story supports it',value:memory.pacing.openingFiveSecondsMedianMs,scope:'general',confidence:'low',evidence:'DERIVED from media placements during the first five seconds',support:'ADVISORY',status:'PROPOSED'});
  if(memory.picture.graphicLikeClips)rules.push({id:'graphics',kind:'graphic_rhythm',summary:'Use brief graphic overlays when content and available templates support them',value:memory.picture.graphicLikeMedianMs||0,scope:'general',confidence:'low',evidence:`INFERRED from ${memory.picture.graphicLikeClips} Graphic-labeled clips; text and font unavailable`,support:'ADVISORY',status:'PROPOSED'});
  const questions:TrainingQuestion[]=[];
  return {rules,questions};
}

export function answerTrainingQuestion(session:TrainingSession,questionId:string,answer:'agree'|'disagree'|'reference_only',reason=''):TrainingSession{
  const next=structuredClone(session),question=next.questions.find(x=>x.id===questionId);if(!question)throw Error('Training question not found');if(question.answered)throw Error('Training question already answered');
  const rule=next.rules.find(x=>x.id===question.ruleId)!;question.answered=answer;rule.status=answer==='disagree'?'REJECTED':'CONFIRMED';rule.scope=answer==='reference_only'?'reference_only':'general';rule.editorReason=reason.trim().slice(0,1000);next.updatedAt=new Date().toISOString();next.history.push({at:next.updatedAt,event:'question_answered',detail:questionId+': '+answer});return next;
}

export class TrainingSessionStore {
  constructor(public root=resolve('projects','v2','training-sessions')){}
  private file(id:string){if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid training session ID');return join(this.root,id+'.json')}
  get(id:string):TrainingSession|undefined{const path=this.file(id);return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):undefined}
  private all(agentId:string){if(!existsSync(this.root))return [] as TrainingSession[];return readdirSync(this.root).filter(name=>/^[0-9a-f-]{36}\.json$/i.test(name)).map(name=>{try{return this.get(name.slice(0,-5))}catch{return undefined}}).filter((x):x is TrainingSession=>!!x&&x.agentId===agentId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
  latest(agentId:string,projectPath?:string):TrainingSession|undefined{return this.all(agentId).find(x=>projectPath===undefined||x.projectPath===projectPath)}
  latestCompleted(agentId:string,version?:number):TrainingSession|undefined{return this.all(agentId).find(x=>(version===undefined||x.agentVersion===version)&&x.history.some(item=>item.event==='reference_learning_complete')&&!!x.referenceReport?.audioEvidence&&Array.isArray(x.referenceReport?.mediaEvidence?.frames)&&!!executablePacingRule(x.rules))}
  save(session:TrainingSession){if(session.schemaVersion!==1)throw Error('Invalid training session schema');mkdirSync(this.root,{recursive:true});const path=this.file(session.id),temp=path+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(session,null,2)+'\n','utf8');renameSync(temp,path);return session}
  create(input:{agentId:string;agentVersion:number;projectPath:string;referenceSequenceId:string;report:any}):TrainingSession{const at=new Date().toISOString(),id=randomUUID(),proposals=proposeReferenceRules(input.report);return this.save({schemaVersion:1,id,createdAt:at,updatedAt:at,agentId:input.agentId,agentVersion:input.agentVersion,projectPath:input.projectPath,referenceSequenceId:input.referenceSequenceId,referenceFingerprint:input.report.sourceFingerprint,step:'CLARIFY',progress:{label:'Reference read and structural analysis complete',completed:['Premiere timeline read','Structural style measured']},referenceReport:input.report,rules:proposals.rules,questions:proposals.questions,cycles:[],history:[{at,event:'reference_learned',detail:'Read-only Premiere Direct snapshot'}]})}
  baseline(sessionId:string,runId:string,snapshot:any){const dir=join(this.root,sessionId);mkdirSync(dir,{recursive:true});const path=join(dir,runId+'-baseline.json');if(existsSync(path)){const saved=JSON.parse(readFileSync(path,'utf8'));if(snapshotHash(saved)!==snapshotHash(snapshot))throw Error('Immutable TEST baseline already exists with different contents');return {path,hash:snapshotHash(saved)}}writeFileSync(path,JSON.stringify(snapshot,null,2)+'\n',{encoding:'utf8',flag:'wx'});return {path,hash:snapshotHash(snapshot)}}
  correction(sessionId:string,runId:string,snapshot:any){const dir=join(this.root,sessionId);mkdirSync(dir,{recursive:true});const path=join(dir,runId+'-correction-'+randomUUID()+'.json');writeFileSync(path,JSON.stringify(snapshot,null,2)+'\n',{encoding:'utf8',flag:'wx'});return {path,hash:snapshotHash(snapshot)}}
  readBaseline(path:string,hash:string){const snapshot=JSON.parse(readFileSync(path,'utf8'));if(snapshotHash(snapshot)!==hash)throw Error('Immutable TEST baseline changed');return snapshot}
}

export function proposeCorrectionRule(changes:TimelineChange[],before:any,after:any,reason:string):TrainingRule|null{
  if(!changes.length)return null;
  const original=analyzeReferenceSnapshot(before,'training-baseline',{caption:false,title:false}),corrected=analyzeReferenceSnapshot(after,'training-corrected',{caption:false,title:false});
  const previous=original.observed.shotDurationMs.median,next=corrected.observed.shotDurationMs.median;
  if(previous&&next&&Math.abs(next-previous)>=100)return {id:'correction_'+randomUUID(),kind:'shot_pacing',summary:'Use corrected TEST visual pace as a flexible guide',value:next,scope:'general',confidence:'medium',evidence:`OBSERVED correction: median ${previous} ms → ${next} ms; editor explanation: ${reason.slice(0,500)}`,support:'EXECUTABLE',status:'PROPOSED'};
  return {id:'correction_'+randomUUID(),kind:'editor_instruction',summary:'Consider the editor’s correction explanation in future planning',value:reason.slice(0,500),scope:'general',confidence:'low',evidence:`OBSERVED ${changes.length} changed timeline properties; purpose supplied by editor`,support:'ADVISORY',status:'PROPOSED'};
}
