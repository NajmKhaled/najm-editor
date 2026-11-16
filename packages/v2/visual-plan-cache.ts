import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildFeasibleExecutionPlan,createCandidates,createVisualSlots,type CandidateSelectionPlan} from './candidate-plan.js';
import {validateVisual} from './validate.js';
import type {StoryPlan,VisualPlan} from './workflow-types.js';

export const VISUAL_PLAN_SCHEMA_VERSION=4;
export const VISUAL_NORMALIZER_VERSION=7;
export const VISUAL_VALIDATOR_VERSION=5;
export type VisualCacheState='RAW'|'NORMALIZED'|'VALID'|'INVALID';
export interface VisualCacheManifest {state:VisualCacheState;visualKey:string;rawHash:string;visualPlanSchemaVersion:number;visualNormalizerVersion:number;visualValidatorVersion:number;checkedAt:number;error?:string;repairs?:string[]}
export interface VisualCacheFiles {raw:string;normalized:string;validation:string;manifest:string}
export interface VisualPreflightResult {raw:CandidateSelectionPlan;normalized:VisualPlan;manifest:VisualCacheManifest;reusedRaw:boolean;repairs:string[]}
export interface VisualModelResult {value:CandidateSelectionPlan;cached:boolean}
export type VisualModelLoader=(forceFresh:boolean)=>Promise<VisualModelResult>;
export function visualCacheFiles(dir:string):VisualCacheFiles{return {raw:join(dir,'CALL2_RAW.json'),normalized:join(dir,'CALL2_NORMALIZED.json'),validation:join(dir,'CALL2_VALIDATION.json'),manifest:join(dir,'model','CALL2_EXECUTION_CACHE.json')}}
function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function versionsMatch(manifest:any){return manifest?.visualPlanSchemaVersion===VISUAL_PLAN_SCHEMA_VERSION&&manifest?.visualNormalizerVersion===VISUAL_NORMALIZER_VERSION&&manifest?.visualValidatorVersion===VISUAL_VALIDATOR_VERSION}
function isSelectionPlan(value:any):value is CandidateSelectionPlan{return !!value&&typeof value.title_ar==='string'&&Array.isArray(value.shots)&&value.shots.every((s:any)=>typeof s.shot_id==='string'&&Array.isArray(s.candidate_ids)&&typeof s.relevance_reason==='string'&&typeof s.visual_description==='string'&&Number.isFinite(s.confidence)&&(!s.alternatives||Array.isArray(s.alternatives)&&s.alternatives.every((a:any)=>Array.isArray(a.candidate_ids)&&typeof a.relevance_reason==='string'&&typeof a.visual_description==='string'&&Number.isFinite(a.confidence))))}
function saveJson(path:string,value:unknown){writeFileSync(path,JSON.stringify(value,null,2))}

/** Fresh model output and saved candidate-ID selections converge here before Premiere planning. */
export async function loadAndPreflightVisualPlan(args:{dir:string;visualKey:string;media:any[];story:StoryPlan;cleanMapping:any[];duration:number;sequenceFps:number;loadModel:VisualModelLoader;forceFresh?:boolean}):Promise<VisualPreflightResult>{
  const files=visualCacheFiles(args.dir);mkdirSync(join(args.dir,'model'),{recursive:true});let prior:any;try{prior=JSON.parse(readFileSync(files.manifest,'utf8'))}catch{}
  const hasRaw=existsSync(files.raw);let oldRaw:any;try{if(hasRaw)oldRaw=JSON.parse(readFileSync(files.raw,'utf8'))}catch{}const rawUsable=isSelectionPlan(oldRaw),sameKey=prior?.visualKey===args.visualKey,matchingRaw=rawUsable&&sameKey;let raw:CandidateSelectionPlan,reusedRaw=false;
  // A normalizer/validator change must first retry a same-key candidate selection
  // locally. An INVALID execution manifest describes the old local build result,
  // not necessarily a bad model response.
  const loadSelection=async(forceFresh:boolean)=>{const result=await args.loadModel(forceFresh);if(!isSelectionPlan(result.value))throw Error('Call 2 returned an incompatible source-timestamp plan; candidate-ID contract required');return {value:result.value,cached:result.cached}};
  if(matchingRaw&&!args.forceFresh){raw=oldRaw;reusedRaw=true}else{const forceFresh=!!args.forceFresh||!!(sameKey&&prior?.state==='INVALID')||!!prior&&!versionsMatch(prior)||hasRaw&&!rawUsable;const result=await loadSelection(forceFresh);raw=result.value;reusedRaw=result.cached;saveJson(files.raw,raw)}
  const candidates=createCandidates(args.media),slots=createVisualSlots(args.story,args.cleanMapping,args.duration,candidates,args.sequenceFps);
  const normalize=(selection:CandidateSelectionPlan)=>{let normalized:VisualPlan={title_ar:selection.title_ar,shots:[]},errors:string[]=[],repairs:string[]=[];try{const feasible=buildFeasibleExecutionPlan(selection,slots,candidates,args.media,args.story,args.cleanMapping);normalized=feasible.plan;repairs=feasible.repairs;validateVisual(normalized,args.duration,args.media,args.story)}catch(error){errors.push(String(error).replace(/^Error:\s*/,''))}return {normalized,errors,repairs}};
  let result=normalize(raw);
  if(result.errors.length&&reusedRaw&&!args.forceFresh){const fresh=await loadSelection(true);raw=fresh.value;reusedRaw=fresh.cached;saveJson(files.raw,raw);result=normalize(raw)}
  const base={visualKey:args.visualKey,rawHash:hash(raw),visualPlanSchemaVersion:VISUAL_PLAN_SCHEMA_VERSION,visualNormalizerVersion:VISUAL_NORMALIZER_VERSION,visualValidatorVersion:VISUAL_VALIDATOR_VERSION,checkedAt:Date.now()};saveJson(files.manifest,{...base,state:'RAW'});
  const valid=result.errors.length===0,manifest:VisualCacheManifest={...base,state:valid?'VALID':'INVALID',...(valid?{}:{error:result.errors.join('; ')}),repairs:result.repairs};saveJson(files.normalized,result.normalized);saveJson(files.validation,{state:manifest.state,valid,visualKey:args.visualKey,versions:{visualPlanSchemaVersion:manifest.visualPlanSchemaVersion,visualNormalizerVersion:manifest.visualNormalizerVersion,visualValidatorVersion:manifest.visualValidatorVersion},candidateCount:candidates.length,slotCount:slots.length,errors:result.errors,repairs:result.repairs,shots:result.normalized.shots.map(s=>({shotId:s.shot_id,candidateId:s.candidate_id,media:s.source_media,sourceIn:s.source_in,sourceOut:s.source_out,timelineStart:s.timeline_start,timelineEnd:s.timeline_end,status:'CHECKED'}))});saveJson(files.manifest,manifest);
  if(!valid)throw Object.assign(Error('SEMANTIC_PLAN_ERROR: '+manifest.error),{visualPreflight:{raw,normalized:result.normalized,manifest}});return {raw,normalized:result.normalized,manifest,reusedRaw,repairs:result.repairs};
}
export function visualManifestIsReusable(value:any,visualKey:string){return value?.visualKey===visualKey&&value?.state==='VALID'&&versionsMatch(value)}
