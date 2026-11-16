import type {Candidate,VisualSlot} from './candidate-plan.js';
import {editorialAssetLabel,type SourceMediaContext} from './source-context.js';
import {planningAgentPreference,type AgentPreferences} from './agent-store.js';
import type {ResolvedTestSection} from './test-section.js';
import {executablePacingRule} from './training-studio.js';

export interface SpokenEditingRequest {phraseId:string;start:number;end:number;text:string}

/** Editorial input only. Paths and execution timestamps remain in the local index. */
export function buildVisualCall2Input(story:string,slots:VisualSlot[],candidates:Candidate[],media:any[],instruction:string,context?:SourceMediaContext,spokenRequests:SpokenEditingRequest[]=[],agent?:AgentPreferences,test?:ResolvedTestSection){
  const pacing=executablePacingRule(agent?.trainingRules||agent?.approvedTraining?.rules||agent?.learnedTraining?.rules);
  const contextByPath=new Map((context?.assets||[]).map(asset=>[asset.mediaPath.replace(/\//g,'\\').toLowerCase(),asset]));
  const assets=media.map((m,i)=>{const id='M'+String(i+1).padStart(3,'0'),label=contextByPath.get(String(m.mediaPath||'').replace(/\//g,'\\').toLowerCase());return {...(label?editorialAssetLabel(label):{}),id,name:label?editorialAssetLabel(label).name:String(m.filename||'source asset'),durationMs:Math.round(Number(m.duration)*1000),fps:m.frameRate,sheet:i+1,
    ranges:candidates.filter(c=>c.mediaId===id).map(c=>({id:c.candidateId,cell:c.contactSheetIndex+1,usableMs:Math.floor(c.availableDuration*1000)}))}});
  return JSON.stringify({clean_story:story,source_sequence:context?.sequenceName==='Synthetic shapes source'?'Synthetic shapes source':'Source sequence',slots:slots.map(s=>({id:s.shot_id,beat:s.story_beat_id,spoken:s.spoken_text,durationMs:Math.round(s.requiredDuration*1000)})),assets,
    ...(instruction?{instruction}:{}),...(spokenRequests.length?{spoken_editing_requests:spokenRequests}:{}),...(agent?{agent_preferences:planningAgentPreference(agent)}:{}),
    ...(pacing||test&&agent?.approvedReference?{reference_editing:{target_shot_duration_ms:Number(pacing?.value||agent?.approvedReference?.targetShotDurationMs),...(agent?.approvedReference?.styleMemory?{structural_style_memory:agent.approvedReference.styleMemory}:{}),applies_to:'candidate selection and layering within narration slots; derive footage choices from current media',source:pacing?'confirmed agent training rule':'editor-approved reference timeline'}}:{}),
    ...(test?{test_section:{start:test.start,end:test.end,speechStart:test.speechStart,speechEnd:test.speechEnd},surrounding_story_context:{before:test.before,after:test.after}}:{})});
}
