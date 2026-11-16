import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {approvedReferencePreference,type ApprovedReferencePreference,type ReferenceStyleMemory} from './reference-learning.js';
import type {CorrectionRetest,TrainingRule} from './training-studio.js';

export interface ApprovedTrainingProfile {schemaVersion:1;sessionId:string;approvedAt:string;rules:TrainingRule[];testRunIds:string[];capabilityLimitations:string[];requirements:{captionTemplateHash:string;titleTemplateHash:string};knowledge?:{schemaVersion:1;provenance:{referenceFingerprint:string;observedAt:string;referenceSequenceId?:string;projectFingerprint?:string};observed:{shotCount:number;cuts:number;audioTrackCount:number;graphicTextClips:number};inferred:{styleMemory:ReferenceStyleMemory|null;audioStatus:string}};referenceExamples?:{clipId:string;timelineTime:number;sourceTime:number}[];correctionHistory?:{runId:string;changeCount:number;editorReason:string}[];retestResults?:CorrectionRetest[]}
export type LearnedTrainingProfile=Omit<ApprovedTrainingProfile,'approvedAt'|'testRunIds'|'correctionHistory'|'retestResults'>&{learnedAt:string;verification:'LEARNED_ONLY'};
export interface EditingAgent {schemaVersion:1;id:string;version:number;name:string;description:string;instructions:string;draft:boolean;createdAt:string;updatedAt:string;approvedReference?:ApprovedReferencePreference;approvedTraining?:ApprovedTrainingProfile;learnedTraining?:LearnedTrainingProfile}
export type AgentPreferences=Pick<EditingAgent,'id'|'version'|'name'|'instructions'|'approvedReference'|'approvedTraining'|'learnedTraining'>&{draft?:boolean;trainingRules?:TrainingRule[];trainingStyleMemory?:ReferenceStyleMemory|null};
export function reusableTraining(agent:AgentPreferences){return agent.approvedTraining||agent.learnedTraining}
/** Keep reference project details and raw editor explanations out of a new project's model prompt. */
export function planningAgentPreference(agent:AgentPreferences){const profile=reusableTraining(agent),rules=agent.trainingRules||profile?.rules||[],memory=agent.trainingStyleMemory||profile?.knowledge?.inferred.styleMemory;return {version:agent.version,instructions:agent.instructions,confirmed_rules:rules.filter(r=>r.status==='CONFIRMED'&&r.scope==='general'&&r.support!=='UNAVAILABLE').map(r=>({kind:r.kind,summary:r.summary,value:r.value,support:r.support})),...(memory?{structural_style_memory:memory}:{})}}
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value:unknown,label:string,max:number,allowEmpty=false){
  if(typeof value!=='string'||value.length>max||(!allowEmpty&&!value.trim())||/\u0000/.test(value))throw Error(label+' must be '+(allowEmpty?'a':'a non-empty')+' string of at most '+max+' characters');
  return value.trim();
}
function validId(id:unknown):asserts id is string{if(typeof id!=='string'||!idPattern.test(id))throw Error('Invalid agent ID')}
function validRecord(value:any):EditingAgent{
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1)throw Error('Invalid saved agent schema');
  validId(value.id);
  if(!Number.isSafeInteger(value.version)||value.version<1||typeof value.draft!=='boolean')throw Error('Invalid saved agent version or status');
  requiredText(value.name,'Agent name',100);requiredText(value.description,'Agent description',500,true);
  requiredText(value.instructions,'Agent instructions',8000,true);
  if(value.approvedReference!==undefined)approvedReferencePreference(value.approvedReference);
  if(value.approvedTraining!==undefined){const p=value.approvedTraining;if(value.draft||p?.schemaVersion!==1||typeof p.sessionId!=='string'||typeof p.approvedAt!=='string'||!Array.isArray(p.rules)||!p.rules.some((r:TrainingRule)=>r.status==='CONFIRMED'&&r.support==='EXECUTABLE')||!Array.isArray(p.testRunIds)||p.testRunIds.length<1||!Array.isArray(p.capabilityLimitations)||typeof p.requirements?.captionTemplateHash!=='string'||typeof p.requirements?.titleTemplateHash!=='string'||p.referenceExamples!==undefined&&(!Array.isArray(p.referenceExamples)||p.referenceExamples.length>50||p.referenceExamples.some((x:any)=>typeof x.clipId!=='string'||!Number.isFinite(x.timelineTime)||!Number.isFinite(x.sourceTime)))||p.correctionHistory!==undefined&&(!Array.isArray(p.correctionHistory)||p.correctionHistory.length>50||p.correctionHistory.some((x:any)=>typeof x.runId!=='string'||!Number.isSafeInteger(x.changeCount)||x.changeCount<0||typeof x.editorReason!=='string'||x.editorReason.length>1000)))throw Error('Invalid approved training profile')}
  if(value.learnedTraining!==undefined){const p=value.learnedTraining;if(p?.schemaVersion!==1||p.verification!=='LEARNED_ONLY'||typeof p.sessionId!=='string'||typeof p.learnedAt!=='string'||!Array.isArray(p.rules)||!p.rules.some((r:TrainingRule)=>r.status==='CONFIRMED'&&r.support==='EXECUTABLE'&&r.scope==='general')||!Array.isArray(p.capabilityLimitations)||typeof p.requirements?.captionTemplateHash!=='string'||typeof p.requirements?.titleTemplateHash!=='string'||p.referenceExamples!==undefined&&(!Array.isArray(p.referenceExamples)||p.referenceExamples.length>50||p.referenceExamples.some((x:any)=>typeof x.clipId!=='string'||!Number.isFinite(x.timelineTime)||!Number.isFinite(x.sourceTime))))throw Error('Invalid learned training profile')}
  for(const p of [value.approvedTraining,value.learnedTraining].filter(Boolean)){const hash=/^[a-f0-9]{64}$/i;
    if(!hash.test(p.requirements.captionTemplateHash)||!hash.test(p.requirements.titleTemplateHash)||p.rules.length>200||p.rules.some((r:any)=>!r||typeof r.id!=='string'||!r.id||typeof r.summary!=='string'||typeof r.evidence!=='string'||!['shot_pacing','opening_pacing','graphic_rhythm','audio_layers','editor_instruction'].includes(r.kind)||!['general','reference_only'].includes(r.scope)||!['low','medium','high'].includes(r.confidence)||!['EXECUTABLE','ADVISORY','UNAVAILABLE'].includes(r.support)||!['PROPOSED','CONFIRMED','REJECTED'].includes(r.status)||typeof r.value!=='string'&&typeof r.value!=='number'||typeof r.value==='number'&&!Number.isFinite(r.value)))throw Error('Saved agent has invalid rules or dependency hashes');
    if(p.knowledge){const k=p.knowledge,o=k.observed,s=k.inferred?.styleMemory;
      if(k.schemaVersion!==1||!hash.test(k.provenance?.referenceFingerprint)||typeof k.provenance.observedAt!=='string'||!o||[o.shotCount,o.cuts,o.audioTrackCount,o.graphicTextClips].some((n:any)=>!Number.isSafeInteger(n)||n<0)||!k.inferred||typeof k.inferred.audioStatus!=='string'||s!==null&&(!s||s.schemaVersion!==1||s.status!=='DERIVED'||!Number.isFinite(s.pacing?.lowerQuartileMs)||!Number.isFinite(s.pacing?.upperQuartileMs)))throw Error('Invalid saved agent knowledge');
    }
  }
  const retests=value.approvedTraining?.retestResults;
  if(retests!==undefined&&(!Array.isArray(retests)||retests.length>50||retests.some((x:any)=>!x||Object.keys(x).sort().join(',')!=='currentErrorMs,currentObservedMs,priorErrorMs,priorObservedMs,priorRunId,ruleId,status,targetMs'||typeof x.ruleId!=='string'||typeof x.priorRunId!=='string'||!Number.isInteger(x.targetMs)||x.targetMs<500||x.targetMs>10000||!['IMPROVED','UNCHANGED','REGRESSED','UNAVAILABLE'].includes(x.status)||['priorObservedMs','currentObservedMs','priorErrorMs','currentErrorMs'].some(k=>x[k]!==null&&(!Number.isFinite(x[k])||x[k]<0)))))throw Error('Invalid approved retest results');
  if(!value.draft&&!value.approvedTraining)throw Error('Approved agent requires completed training');
  if(typeof value.createdAt!=='string'||typeof value.updatedAt!=='string')throw Error('Invalid saved agent timestamps');
  return value as EditingAgent;
}

export class EditingAgentStore {
  constructor(public root=resolve('projects','v2','agents')){}
  private file(id:string){validId(id);return join(this.root,id+'.json')}
  get(id:string,version?:number){const file=this.file(id),historyDir=join(this.root,'history',id);
    if(version!==undefined){if(!Number.isSafeInteger(version)||version<1)throw Error('Invalid agent version');const historical=join(historyDir,String(version)+'.json');if(existsSync(historical))return validRecord(JSON.parse(readFileSync(historical,'utf8')));if(existsSync(file)){const current=validRecord(JSON.parse(readFileSync(file,'utf8')));if(current.version===version)return current}return undefined}
    let current:EditingAgent|undefined,currentError:unknown;
    if(existsSync(file))try{current=validRecord(JSON.parse(readFileSync(file,'utf8')))}catch(error){currentError=error}
    if(existsSync(historyDir)){const versions=readdirSync(historyDir).filter(name=>/^\d+\.json$/.test(name)).map(name=>Number(name.slice(0,-5))).filter(Number.isSafeInteger).sort((a,b)=>b-a);const latest=versions[0];if(latest&&(!current||latest>current.version)){const recovered=validRecord(JSON.parse(readFileSync(join(historyDir,String(latest)+'.json'),'utf8')));if(recovered.id!==id||recovered.version!==latest)throw Error('Saved agent history identity mismatch');mkdirSync(this.root,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(recovered,null,2)+'\n','utf8');renameSync(temp,file);current=recovered}}
    if(!current&&currentError)throw currentError;
    return current;
  }
  list(){if(!existsSync(this.root))return [];const ids=new Set(readdirSync(this.root).filter(name=>idPattern.test(name.replace(/\.json$/,''))&&name.endsWith('.json')).map(name=>name.slice(0,-5)));const history=join(this.root,'history');if(existsSync(history))for(const name of readdirSync(history))if(idPattern.test(name))ids.add(name);return [...ids].map(id=>this.get(id)).filter((x):x is EditingAgent=>!!x).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))}
  save(input:any,approvedOverride?:ApprovedReferencePreference):EditingAgent{
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Agent must be an object');
    const allowed=new Set(['id','version','name','description','instructions','draft']);
    if(Object.keys(input).some(key=>!allowed.has(key)))throw Error('Agent contains unsupported fields');
    const existing=input.id===undefined?undefined:this.get(input.id);
    if(input.id!==undefined&&!existing)throw Error('Agent not found');
    if(existing&&input.version!==existing.version)throw Error('Agent version conflict; reload before saving');
    if(!existing&&input.version!==undefined)throw Error('New agent cannot supply a version');
    if(input.draft!==true)throw Error('Agents must remain drafts');
    const name=requiredText(input.name,'Agent name',100),description=requiredText(input.description,'Agent description',500,true),instructions=requiredText(input.instructions,'Agent instructions',8000,input.draft);
    const now=new Date().toISOString();
    const approvedReference=approvedOverride===undefined?existing?.approvedReference:approvedReferencePreference(approvedOverride);
    const agent:EditingAgent={schemaVersion:1,id:existing?.id||randomUUID(),version:(existing?.version||0)+1,name,description,instructions,draft:input.draft,createdAt:existing?.createdAt||now,updatedAt:now,...(approvedReference?{approvedReference}:{}),...(existing?.learnedTraining?{learnedTraining:existing.learnedTraining}:{})};
    mkdirSync(this.root,{recursive:true});const file=this.file(agent.id),temp=file+'.'+randomUUID()+'.tmp',historyDir=join(this.root,'history',agent.id),serialized=JSON.stringify(agent,null,2)+'\n';
    mkdirSync(historyDir,{recursive:true});writeFileSync(temp,serialized,'utf8');writeFileSync(join(historyDir,String(agent.version)+'.json'),serialized,{encoding:'utf8',flag:'wx'});renameSync(temp,file);return agent;
  }
  approveReference(id:string,version:number,preference:ApprovedReferencePreference){const existing=this.get(id);if(!existing)throw Error('Agent not found');return this.save({id,version,name:existing.name,description:existing.description,instructions:existing.instructions,draft:true},approvedReferencePreference(preference))}
  approveTraining(id:string,version:number,profile:ApprovedTrainingProfile){const existing=this.get(id);if(!existing||existing.version!==version||!existing.draft)throw Error('Draft agent version changed');if(profile.schemaVersion!==1||profile.testRunIds.length<1||!profile.rules.some(rule=>rule.status==='CONFIRMED'&&rule.support==='EXECUTABLE'))throw Error('Training approval requires a verified TEST and an executable learned rule');const now=new Date().toISOString(),agent:EditingAgent={...existing,version:version+1,draft:false,updatedAt:now,approvedTraining:profile};validRecord(agent);mkdirSync(this.root,{recursive:true});const file=this.file(id),temp=file+'.'+randomUUID()+'.tmp',historyDir=join(this.root,'history',id),serialized=JSON.stringify(agent,null,2)+'\n';mkdirSync(historyDir,{recursive:true});writeFileSync(temp,serialized,'utf8');writeFileSync(join(historyDir,String(agent.version)+'.json'),serialized,{encoding:'utf8',flag:'wx'});renameSync(temp,file);return agent}
  saveLearned(id:string,version:number,profile:LearnedTrainingProfile){const existing=this.get(id);if(!existing||existing.version!==version||!existing.draft)throw Error('Draft agent version changed');const now=new Date().toISOString(),agent:EditingAgent={...existing,version:version+1,updatedAt:now,learnedTraining:profile};validRecord(agent);mkdirSync(this.root,{recursive:true});const file=this.file(id),temp=file+'.'+randomUUID()+'.tmp',historyDir=join(this.root,'history',id),serialized=JSON.stringify(agent,null,2)+'\n';mkdirSync(historyDir,{recursive:true});writeFileSync(temp,serialized,'utf8');writeFileSync(join(historyDir,String(agent.version)+'.json'),serialized,{encoding:'utf8',flag:'wx'});renameSync(temp,file);return agent}
  rename(id:string,version:number,name:string){const existing=this.get(id);if(!existing||existing.version!==version)throw Error('Agent version changed; reload before saving');name=requiredText(name,'Agent name',100);const agent={...existing,name,version:version+1,updatedAt:new Date().toISOString()};validRecord(agent);const file=this.file(id),temp=file+'.'+randomUUID()+'.tmp',historyDir=join(this.root,'history',id),serialized=JSON.stringify(agent,null,2)+'\n';mkdirSync(historyDir,{recursive:true});writeFileSync(temp,serialized);writeFileSync(join(historyDir,String(agent.version)+'.json'),serialized,{flag:'wx'});renameSync(temp,file);return agent;}
  preferences(id:string):AgentPreferences{const agent=this.get(id);if(!agent)throw Error('Agent not found');return {id:agent.id,version:agent.version,name:agent.name,draft:agent.draft,instructions:agent.instructions,...(agent.approvedReference?{approvedReference:agent.approvedReference}:{}),...(agent.approvedTraining?{approvedTraining:agent.approvedTraining}:{}),...(agent.learnedTraining?{learnedTraining:agent.learnedTraining}:{})}}
}
