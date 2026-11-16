import type {ModelProvider,ModelResult} from './model.js';
import type {CandidateSelectionPlan} from './candidate-plan.js';

/** Deterministic inference fixture. No network, subprocess, credentials or ASR. */
export class FixtureModelProvider implements ModelProvider {
  async ready(){return true}
  async runStoryCleanup(_input:string,_dir:string):Promise<ModelResult<any>>{throw Error('FIXTURE_ONLY: use npm run demo with the supplied synthetic transcript; real-project editing requires an explicit provider choice')}
  async runVisualEditPlan(input:string,_images:string[],_dir:string):Promise<ModelResult<CandidateSelectionPlan>>{
    const x=JSON.parse(input);if(x.source_sequence!=='Synthetic shapes source')throw Error('FIXTURE_ONLY: inference fixtures accept only the synthetic demo');
    const target=x.reference_editing?.target_shot_duration_ms||2000;
    return {cached:false,value:{title_ar:'حكاية الأشكال',shots:x.slots.map((slot:any,i:number)=>{
      const asset=x.assets[i%x.assets.length],count=Math.max(1,Math.ceil(slot.durationMs/target));
      if(count>asset.ranges.length)throw Error('Fixture has insufficient candidates for requested pacing');
      return {shot_id:slot.id,candidate_ids:asset.ranges.slice(0,count).map((r:any)=>r.id),visual_description:asset.name,relevance_reason:'FIXTURE: match the supplied shape label to this narration slot',confidence:1,alternatives:[]};
    })}};
  }
}
