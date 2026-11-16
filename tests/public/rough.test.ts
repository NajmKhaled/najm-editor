import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ensureTarget} from '../../packages/v2/recovery.js';import {sourceUnchanged} from '../../packages/v2/validate.js';
import {hostFixture} from './host-fixture.js';
test('partial rough writes replay into same target; unrelated/manual picture is never overwritten',async()=>{
 const bridge=hostFixture(),dir=mkdtempSync(join(tmpdir(),'najm-rough-')),video=join(dir,'camera.mp4'),audio=join(dir,'silence.wav');writeFileSync(video,'synthetic');writeFileSync(audio,'synthetic');bridge.item(video,12);bridge.item(audio,4,'audio');
 const sourceId=bridge.source.sequenceID,sourceSnapshot=await bridge.call('getSequenceSnapshot',{sequenceId:sourceId}),options={bridge,dir,runId:'rough-run',sourceId,sourceSnapshot,planKey:'fixture',preserveTimeline:false},target=await ensureTarget(options);
 const shots=[{shot_id:'a',source_media:video,source_in:0,source_out:2,timeline_start:0,timeline_end:2},{shot_id:'b',source_media:video,source_in:2,source_out:4,timeline_start:2,timeline_end:4}],args={sequenceId:target.sequenceId,sourceSequenceId:sourceId,runId:options.runId,targetReceiptPath:join(dir,'TARGET_RECEIPT.json'),cleanNarrationPath:audio,shots,sourceAudio:[]};
 bridge.failNext(1);await assert.rejects(bridge.call('buildRoughCutBatch',args),/interruption/);bridge.noFailure();bridge.restart();await bridge.call('buildRoughCutBatch',args);await bridge.call('buildRoughCutBatch',args);assert.equal(bridge.sequences[1].videoTracks[0].clips.numItems,2);
 bridge.sequences[1].videoTracks[0].clips[0].end.seconds=1.5;await assert.rejects(bridge.call('buildRoughCutBatch',args),/existing clip differs/);assert.equal(bridge.sequences[1].videoTracks[0].clips[0].end.seconds,1.5);sourceUnchanged(sourceSnapshot,await bridge.call('getSequenceSnapshot',{sequenceId:sourceId}));
});
