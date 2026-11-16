import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {run} from '../../packages/pipeline/process.js';
import {resolvePythonRuntime} from '../../packages/pipeline/python-runtime.js';
import {makeCleanAudio,validateCleanAudio} from '../../packages/v2/sample-audio.js';
test('local media integration uses synthetic PCM and the installation-pinned Python resolver',async()=>{
 const runtime=await resolvePythonRuntime();assert.equal(runtime.source,'central',runtime.error);
 const dir=mkdtempSync(join(tmpdir(),'najm-media-')),source=join(dir,'sine.wav');await run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=3:sample_rate=48000','-c:a','pcm_s24le',source]);
 const clean=await makeCleanAudio(source,[{source_start:.1,source_end:1,corrected_text:'synthetic'},{source_start:2,source_end:2.8,corrected_text:'synthetic'}],dir);assert.equal((await validateCleanAudio(source,clean,dir)).pass,true);
});
