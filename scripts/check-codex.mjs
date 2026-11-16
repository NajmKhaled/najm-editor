import {spawnSync} from 'node:child_process';import {join} from 'node:path';import {homedir} from 'node:os';
const cli=process.env.NAJM_CODEX_CLI||join(process.env.APPDATA||join(homedir(),'AppData','Roaming'),'npm/node_modules/@openai/codex/bin/codex.js');
for(const args of [['--version'],['login','status'],['exec','--help']]){
 const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:15000});if(r.status!==0)throw Error('Codex local capability check failed');
 if(args[0]==='exec'){for(const flag of ['--ignore-user-config','--ignore-rules','--output-schema','--ephemeral'])if(!r.stdout.includes(flag))throw Error('Unsupported CLI flag '+flag);console.log('Required CLI flags available');}
 else console.log((r.stdout+r.stderr).trim());
}
if(process.argv.includes('--live')){
 console.log('Synthetic-only cloud check: one shape label, one Arabic sentence, one candidate ID, no images, no private rules or paths. Requires NAJM_CLOUD_CONSENT=transcript-images-rules and NAJM_MODEL_PROVIDER=codex.');
 const {createModelProvider}=await import('../dist/packages/v2/model.js');
 const input=JSON.stringify({source_sequence:'Synthetic shapes source',clean_story:'هذه دائرة حمراء',slots:[{id:'slot_001',beat:'b1',spoken:'هذه دائرة حمراء',durationMs:1000}],assets:[{id:'M001',name:'synthetic red circle',durationMs:12000,sheet:1,ranges:[{id:'C0001',cell:1,usableMs:12000}]}]});
 const result=await createModelProvider().runVisualEditPlan(input,[],'projects/v2/provider-smoke');
 if(result.value.shots.length!==1||result.value.shots[0].shot_id!=='slot_001'||result.value.shots[0].candidate_ids.join(',')!=='C0001')throw Error('Synthetic provider response failed validation');
 console.log('Synthetic structured response accepted. This establishes no subscription entitlement or general no-tools guarantee.');
}
