import type {StoryPlan} from './workflow-types.js';

export interface StoryRepair {plan:StoryPlan;dropped:{reason:string;segment:StoryPlan['remove_segments'][number]}[];deduplicated:number}

/** Repair format-only removal ranges. Kept speech and editorial choices stay untouched. */
export function sanitizeStoryRemovals(plan:StoryPlan,narrationDuration:number,epsilon=0.001):StoryRepair {
  if(!Number.isFinite(narrationDuration)||narrationDuration<=0)throw Error('SEMANTIC_INVALID_RESULT: narration duration is invalid');
  const dropped:StoryRepair['dropped']=[],seen=new Set<string>(),remove_segments:StoryPlan['remove_segments']=[];
  let deduplicated=0;
  for(const segment of plan.remove_segments||[]){
    const start=Number(segment.source_start),end=Number(segment.source_end);
    if(!Number.isFinite(start)||!Number.isFinite(end)){dropped.push({reason:'non-finite range',segment});continue}
    if(end<start){dropped.push({reason:'reversed range',segment});continue}
    const boundedStart=Math.max(0,Math.min(narrationDuration,start));
    const boundedEnd=Math.max(0,Math.min(narrationDuration,end));
    if(boundedEnd-boundedStart<epsilon){dropped.push({reason:'zero-length range',segment});continue}
    const normalized={...segment,source_start:boundedStart,source_end:boundedEnd};
    const key=JSON.stringify([normalized.source_start,normalized.source_end,normalized.text]);
    if(seen.has(key)){deduplicated++;continue}
    seen.add(key);remove_segments.push(normalized);
  }
  remove_segments.sort((a,b)=>a.source_start-b.source_start||a.source_end-b.source_end||a.text.localeCompare(b.text));
  return {plan:{...plan,remove_segments},dropped,deduplicated};
}
