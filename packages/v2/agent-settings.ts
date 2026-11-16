import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {isAbsolute,join,win32} from 'node:path';
import type {EditingAgent,AgentPreferences} from './agent-store.js';
import {reusableTraining} from './agent-store.js';
import {executablePacingRule} from './training-studio.js';
import {validateMotionSelection} from './motion-contract.js';

export interface LocalTemplate {path:string;sha256:string;compatibility:'UNVERIFIED'|'EDITOR_CONFIRMED'}
export interface AgentLocalSettings {schemaVersion:1;version:number;roles:{caption:'UNMAPPED'|'EDITOR_CONFIRMED';title:'UNMAPPED'|'EDITOR_CONFIRMED'};templates:{caption?:LocalTemplate;title?:LocalTemplate};fontFamily:string;motionEnabled:boolean;motion?:{primary:string;secondary:string;accent:'mint'|'lavender';position:'left'|'right';duration:number;scale:number}}
export const emptyLocalSettings=():AgentLocalSettings=>({schemaVersion:1,version:0,roles:{caption:'UNMAPPED',title:'UNMAPPED'},templates:{},fontFamily:'',motionEnabled:false});
const fileHash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
export class AgentLocalSettingsStore {
 constructor(public root=join('projects','v2','local-agent-settings')){}
 private file(id:string){if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid saved agent identity');return join(this.root,id+'.json')}
 get(id:string):AgentLocalSettings{const file=this.file(id);return existsSync(file)?JSON.parse(readFileSync(file,'utf8')):emptyLocalSettings()}
 save(id:string,input:any){
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['version','roles','templates','fontFamily','motionEnabled','motion'].includes(k)))throw Error('Invalid local agent configuration');
  const current=this.get(id);if(input.version!==current.version)throw Error('Local mappings changed; reload the agent');
  if(!input.roles||Object.keys(input.roles).sort().join(',')!=='caption,title'||Object.values(input.roles).some(v=>!['UNMAPPED','EDITOR_CONFIRMED'].includes(String(v)))||typeof input.fontFamily!=='string'||input.fontFamily.length>120||/[\u0000-\u001f]/.test(input.fontFamily)||typeof input.motionEnabled!=='boolean')throw Error('Invalid local role or font mapping');
  if(!input.templates||Object.keys(input.templates).some(k=>!['caption','title'].includes(k)))throw Error('Invalid template mappings');
  const templates:AgentLocalSettings['templates']={};
  for(const kind of ['caption','title'] as const){const t=input.templates[kind];if(!t||!t.path)continue;if(Object.keys(t).some(k=>!['path','compatibility'].includes(k))||typeof t.path!=='string'||!(isAbsolute(t.path)||win32.isAbsolute(t.path))||!t.path.toLowerCase().endsWith('.mogrt')||!existsSync(t.path)||!['UNVERIFIED','EDITOR_CONFIRMED'].includes(t.compatibility))throw Error('Map an existing local MOGRT and its editor-confirmed compatibility');templates[kind]={path:t.path,sha256:fileHash(t.path),compatibility:t.compatibility};}
  if(input.motion){const m=input.motion;if(Object.keys(m).sort().join(',')!=='accent,duration,position,primary,scale,secondary')throw Error('Invalid optional motion configuration');validateMotionSelection({preset:'najm.lower-third.v1',text:{primary:m.primary||'Title',secondary:m.secondary},start:0,end:m.duration,fps:30,width:1280,height:720,style:{accent:m.accent,position:m.position,scale:m.scale}},8);}
  const value:AgentLocalSettings={schemaVersion:1,version:current.version+1,roles:{...input.roles},templates,fontFamily:input.fontFamily.trim(),motionEnabled:input.motionEnabled,...(input.motion?{motion:input.motion}:{})};mkdirSync(this.root,{recursive:true});const file=this.file(id),temp=file+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2));renameSync(temp,file);return value;
 }
 resolve(id:string){const config=this.get(id);for(const t of Object.values(config.templates))if(t&&(!existsSync(t.path)||fileHash(t.path)!==t.sha256))throw Error('Local template changed or is missing; remap it before Auto Edit');return config;}
}
export function agentWorkflowSummary(agent:EditingAgent|AgentPreferences,settings=emptyLocalSettings()){
 const profile=reusableTraining(agent),rules=('trainingRules' in agent&&agent.trainingRules)||profile?.rules||[],pace=executablePacingRule(rules as any);
 return {name:agent.name,version:agent.version,verification:agent.approvedTraining?'TEST_VERIFIED':agent.learnedTraining?'LEARNED_ONLY':'DRAFT',
  detected:{pacingMs:pace?.value||agent.approvedReference?.targetShotDurationMs||null,structure:profile?.knowledge?.observed||null},
  confirmed:rules.filter(r=>r.status==='CONFIRMED').map(r=>({kind:r.kind,value:r.value,support:r.support,summary:r.summary})),
  configured:{roles:settings.roles,caption:settings.templates.caption?.compatibility==='EDITOR_CONFIRMED'?'EDITABLE_MOGRT':'NEUTRAL_RENDERED_PNG',title:settings.templates.title?.compatibility==='EDITOR_CONFIRMED'?'EDITABLE_MOGRT':'NEUTRAL_RENDERED_PNG',motion:settings.motionEnabled?'OPTIONAL_RENDERED_LOWER_THIRD':'OFF',privateMappingsStayLocal:true},
  unavailable:['Automatic reference MOGRT identity','Exact font/effect/animation transfer','Template compatibility without editor review'],
  fallbacks:(['caption','title'] as const).filter(k=>settings.templates[k]?.compatibility!=='EDITOR_CONFIRMED').map(k=>k+': original neutral raster graphic; no private template used')};
}
export function cloudDisclosure(agent:AgentPreferences|null){return {provider:process.env.NAJM_MODEL_PROVIDER||'fixture',cloudEnabled:false,categories:['Transcript text and phrase timestamps','Typed edit instructions','Confirmed/advisory rule values','Candidate IDs, durations and attached contact-sheet images'],excluded:['Local template paths and binaries','Local font mapping','Client/agent display name','Physical folder/bin labels by default','Raw Premiere project'],rules:agent?agentWorkflowSummary(agent).confirmed:[],note:'Review this disclosure and the actual source before enabling the optional synthetic-only cloud provider. Audio API upload is a separate opt-in.'};}
