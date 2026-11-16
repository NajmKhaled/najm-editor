import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {renderLowerThird} from '../../packages/v2/motion-renderer.js';
test('optional local HTML/CSS renderer produces verified ProRes alpha without a cloud provider',async()=>{
 const rendered=await renderLowerThird({preset:'najm.lower-third.v1',text:{primary:'عنوان عربي',secondary:'Original sample'},start:1,end:2,fps:24,width:1280,height:720,style:{accent:'lavender',position:'right',scale:1}},12,mkdtempSync(join(tmpdir(),'najm-alpha-')));
 assert.equal(rendered.verification.alpha,'VERIFIED_LOCAL');assert.equal(rendered.verification.duration,1);assert.equal(rendered.verification.premiereImport,'PENDING');
});
