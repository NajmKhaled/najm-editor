import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {runDemo} from '../../demo/run.js';
import {createModelProvider} from '../../packages/v2/model.js';
import {validateSourceAudio} from '../../packages/v2/source-audio.js';
test('reference pacing changes the actual V2 fixture plan from 6 to 12 valid cuts with no network',async()=>{
 const prior=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Offline demo attempted network')};try{const a=await runDemo(mkdtempSync(join(tmpdir(),'najm-slow-')),2000),b=await runDemo(mkdtempSync(join(tmpdir(),'najm-fast-')),1000);assert.equal(a.shotCount,6);assert.equal(b.shotCount,12);assert.equal(a.validation,'VALID');assert.equal(b.validation,'VALID')}finally{globalThis.fetch=prior}
});
test('provider default is fixture and real-project inputs fail rather than switch to cloud',async()=>{delete process.env.NAJM_MODEL_PROVIDER;const provider=createModelProvider();await assert.rejects(provider.runStoryCleanup('{}','unused'),/FIXTURE_ONLY/)});
test('source audio validation rejects missing sound',()=>assert.throws(()=>validateSourceAudio({audioTracks:[]},[{id:'a',mediaPath:'synthetic',trackIndex:1,start:0,end:1,sourceIn:0,sourceOut:1,origin:'clip'}]),/count differs/));
test('local ASR script loads a verified file or local-only cache and contains no cloud fallback',()=>{const script=readFileSync('tools/transcribe_new_project.py','utf8');assert.match(script,/whisper.load_model\(str\(cached\)\)/);assert.match(script,/local_files_only=True/);assert.doesNotMatch(script,/requests\.|api\.openai/)});
