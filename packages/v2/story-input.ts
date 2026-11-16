import {editorialAssetLabel,type SourceMediaContext} from './source-context.js';
import type {StoryPlan} from './workflow-types.js';
import type {SpokenEditingRequest} from './visual-input.js';
import {planningAgentPreference,type AgentPreferences} from './agent-store.js';
import type {ResolvedTestSection} from './test-section.js';
import {executablePacingRule} from './training-studio.js';

/** Editorial context only; spoken content and source boundaries stay authoritative. */
export function buildStoryCall1Input(phrases:any[],brief:string,context?:SourceMediaContext,agent?:AgentPreferences,test?:ResolvedTestSection){
  const pacing=executablePacingRule(agent?.trainingRules||agent?.approvedTraining?.rules||agent?.learnedTraining?.rules);
  return JSON.stringify({segments:phrases.map((p:any,i:number)=>({id:'p'+String(i+1).padStart(3,'0'),start:p.start,end:p.end,text:p.text})),instruction:brief,
    ...(context?{source_context:{sequenceName:process.env.NAJM_INCLUDE_SOURCE_LABELS==='1'?context.sequenceName:'Source sequence',assets:context.assets.map((asset,i)=>({id:'M'+String(i+1).padStart(3,'0'),...editorialAssetLabel(asset)}))}}:{}),
    ...(agent?{agent_preferences:planningAgentPreference(agent)}:{}),
    ...(pacing||test&&agent?.approvedReference?{reference_editing:{target_shot_duration_ms:Number(pacing?.value||agent?.approvedReference?.targetShotDurationMs),...(agent?.approvedReference?.styleMemory?{structural_style_memory:agent.approvedReference.styleMemory}:{}),applies_to:'visual style only; derive story and hook from current narration',source:pacing?'confirmed agent training rule':'editor-approved reference timeline'}}:{}),
    ...(test?{test_section:{start:test.start,end:test.end,speechStart:test.speechStart,speechEnd:test.speechEnd},surrounding_story_context:{before:test.before,after:test.after}}:{})});
}

/** Resolve the model's IDs to the original Whisper words and verify they were removed. */
export function verifiedSpokenEditingRequests(plan:StoryPlan,phrases:any[]):SpokenEditingRequest[]{
  if(plan.editorial_phrase_ids===undefined)return []; // Saved plans from the earlier contract.
  if(!Array.isArray(plan.editorial_phrase_ids))throw Error('Story editor directions must be phrase IDs');
  const ids=new Set<string>(),requests:SpokenEditingRequest[]=[];
  for(const id of plan.editorial_phrase_ids){
    if(typeof id!=='string'||!/^p\d{3,}$/.test(id))throw Error('Story editor direction has an invalid phrase ID');
    const index=Number(id.slice(1))-1,phrase=phrases[index];
    if(!phrase||id!=='p'+String(index+1).padStart(3,'0'))throw Error('Story editor direction refers to an unknown phrase: '+id);
    if(ids.has(id))continue;ids.add(id);
    const start=Number(phrase.start),end=Number(phrase.end),text=String(phrase.text||'');
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!text.trim())throw Error('Story editor direction has no valid source speech: '+id);
    if(plan.keep_segments.some(x=>Math.min(end,x.source_end)-Math.max(start,x.source_start)>.05))throw Error('Spoken editor direction remains in clean narration: '+id);
    requests.push({phraseId:id,start,end,text});
  }
  return requests.sort((a,b)=>a.start-b.start||a.end-b.end);
}
