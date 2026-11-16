import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {EditingAgentStore,planningAgentPreference} from '../../packages/v2/agent-store.js';
import {AgentLocalSettingsStore,agentWorkflowSummary,emptyLocalSettings,cloudDisclosure} from '../../packages/v2/agent-settings.js';
import {V2Service} from '../../services/v2/service.js';
import {reference} from '../../demo/run.js';
import {runDemo} from '../../demo/run.js';import {snapshotHash} from '../../packages/v2/training-studio.js';
test('local role/template mappings survive agent rename but never enter minimized model preferences',()=>{
 const dir=mkdtempSync(join(tmpdir(),'najm-agent-local-')),store=new EditingAgentStore(join(dir,'agents')),agent=store.save({name:'Demo series',description:'',instructions:'Use supplied footage',draft:true}),settingsStore=new AgentLocalSettingsStore(join(dir,'local')),template=join(dir,'original-test.mogrt');writeFileSync(template,'synthetic test bytes - not an actual MOGRT');
 const settings=settingsStore.save(agent.id,{version:0,roles:{caption:'EDITOR_CONFIRMED',title:'UNMAPPED'},templates:{caption:{path:template,compatibility:'EDITOR_CONFIRMED'}},fontFamily:'Local private note',motionEnabled:false});
 const renamed=store.rename(agent.id,agent.version,'Demo series revised');assert.equal(renamed.version,2);assert.equal(settingsStore.get(renamed.id).templates.caption?.path,template);
 const summary=agentWorkflowSummary(renamed,settings);assert.equal(summary.configured.caption,'EDITABLE_MOGRT');assert.equal(summary.configured.title,'NEUTRAL_RENDERED_PNG');assert.equal(summary.configured.roles.caption,'EDITOR_CONFIRMED');assert.ok(summary.unavailable.length);
 const prompt=JSON.stringify(planningAgentPreference(renamed));assert.ok(!prompt.includes(template));assert.ok(!prompt.includes(renamed.name));assert.ok(!prompt.includes('Local private note'));assert.equal(cloudDisclosure(renamed).cloudEnabled,false);
 writeFileSync(template,'changed');assert.throws(()=>settingsStore.resolve(agent.id),/changed or is missing/);
});
test('unverified native mapping is shown as a neutral fallback and optional motion configuration is constrained',()=>{
 const agent:any={id:'sample',version:1,name:'Sample',instructions:''},settings=emptyLocalSettings();assert.equal(agentWorkflowSummary(agent,settings).configured.motion,'OFF');
 const store=new AgentLocalSettingsStore(mkdtempSync(join(tmpdir(),'najm-config-'))),id='00000000-0000-4000-8000-000000000001';
 assert.throws(()=>store.save(id,{version:0,roles:settings.roles,templates:{},fontFamily:'',motionEnabled:true,motion:{primary:'Name',secondary:'Role',accent:'external',position:'left',duration:2,scale:1}}),/Unapproved/);
});
test('selected reference is read without sequence activation or timeline writes',async()=>{
 const service:any=Object.create(V2Service.prototype),calls:string[]=[],snapshot=reference(2);service.referenceReports=new Map();service.bridge={connected:true,call:async(op:string,args:any)=>{calls.push(op);assert.equal(op,'getReferenceSnapshot');assert.equal(args.sequenceId,snapshot.id);return snapshot}};service.sourceState=async()=>({projectPath:'synthetic',activeSequence:{id:'other',name:'Other source'},sequences:[{id:snapshot.id,name:snapshot.name}]});const before=JSON.stringify(snapshot);const result=await service.analyzeCurrentReference(snapshot.id);assert.equal(result.report.proposed.targetShotDurationMs,2000);assert.deepEqual(calls,['getReferenceSnapshot']);assert.equal(JSON.stringify(snapshot),before);
});
test('cloud review is invalidated when optional lower-third model inputs change',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'najm-disclosure-'));await runDemo(dir,2000);const agents=new EditingAgentStore(join(dir,'agents')),agent=agents.list()[0],service:any=Object.create(V2Service.prototype),snapshot={...reference(2),id:'source',name:'Synthetic shapes source'};
 service.agents=agents;service.localAgentSettings=new AgentLocalSettingsStore(join(dir,'settings'));service.cloudApprovals=new Map();service.sourceState=async()=>({projectPath:'synthetic',activeSequence:{id:'source',name:snapshot.name},sequences:[]});service.loadedAgents=new Map([[service.projectId('synthetic'),{id:agent.id,sourceFingerprint:snapshotHash(snapshot),transcript:{phrases:[{start:0,end:1,text:'عنوان عربي'}]}}]]);service.bridge={call:async(op:string)=>op==='getProjectState'?{projectPath:'synthetic',activeSequence:{id:'source',name:snapshot.name},sequences:[],media:[]}:snapshot};
 const request={agentId:agent.id,brief:''},first=await service.planningPreview(request);await service.approvePlanning({...request,accept:true,disclosureHash:first.disclosureHash});
 service.localAgentSettings.save(agent.id,{version:0,roles:emptyLocalSettings().roles,templates:{},fontFamily:'',motionEnabled:true,motion:{primary:'New title',secondary:'',accent:'mint',position:'left',duration:2,scale:1}});const next=await service.planningPreview(request);assert.equal(next.approvalKey,first.approvalKey);assert.notEqual(next.disclosureHash,first.disclosureHash);
 service.health=async()=>({ready:true});service.approvedCompatible=()=>{};service.activeJob=()=>undefined;service.sourceJob=()=>undefined;const provider=process.env.NAJM_MODEL_PROVIDER;process.env.NAJM_MODEL_PROVIDER='codex';try{await assert.rejects(service.startFresh('',agent.id),/CLOUD_PREVIEW_REQUIRED/)}finally{if(provider===undefined)delete process.env.NAJM_MODEL_PROVIDER;else process.env.NAJM_MODEL_PROVIDER=provider}
});
test('Load Agent honors the chosen fresh source and rejects its learned reference',async()=>{
 const service:any=Object.create(V2Service.prototype),projectPath='synthetic',activated:string[]=[],project={projectPath,activeSequence:{id:'reference',name:'Finished reference'},sequences:[{id:'reference',name:'Finished reference'},{id:'fresh-a',name:'Fresh A'},{id:'fresh-b',name:'Fresh B'}]};
 const agent:any={id:'00000000-0000-4000-8000-000000000001',version:2,name:'Sample',learnedTraining:{rules:[],knowledge:{provenance:{referenceSequenceId:'reference',projectFingerprint:service.projectId(projectPath)}}}};
 service.agents={preferences:()=>agent};service.approvedCompatible=()=>{};service.loadedAgents=new Map();service.verifyAgentNarration=async()=>({audioCacheDir:'synthetic-cache',phraseCount:1,transcript:{phrases:[]}});service.bridge={call:async(op:string,args:any)=>{if(op==='getProjectState')return project;if(op==='activateSourceSequence'){activated.push(args.sequenceId);return {id:args.sequenceId}}return {id:args.sequenceId,name:args.sequenceId,duration:12,sequenceFps:30,width:1080,height:1920,videoTracks:[{index:0,clips:[{mediaPath:process.execPath,start:0,end:12}]}],audioTracks:[{index:0,clips:[]}]}}};
 const result=await service.loadAgent({agentId:agent.id,version:2,sourceSequenceId:'fresh-b'});assert.equal(result.sourceSequenceId,'fresh-b');assert.deepEqual(activated,['fresh-b']);await assert.rejects(service.loadAgent({agentId:agent.id,version:2,sourceSequenceId:'reference'}),/learned reference/);
});
