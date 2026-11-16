import test from 'node:test';import assert from 'node:assert/strict';
import {validateMotionSelection,lowerThirdHtml} from '../../packages/v2/motion-contract.js';
import {FixtureModelProvider} from '../../packages/v2/fixture-model.js';
const valid=()=>({preset:'najm.lower-third.v1',text:{primary:'عنوان عربي',secondary:'Series'},start:1,end:3,fps:24,width:1280,height:720,style:{accent:'mint',position:'left',scale:1}});
test('optional preset accepts only approved text/timing/style and no injected renderer code',()=>{
 assert.equal(validateMotionSelection(valid(),12).preset,'najm.lower-third.v1');
 for(const changed of [{...valid(),html:'script'},{...valid(),preset:'external'},{...valid(),end:20},{...valid(),fps:29},{...valid(),width:2000},{...valid(),style:{...valid().style,accent:'url(remote)'}}])assert.throws(()=>validateMotionSelection(changed,12));
 const x=valid();x.text.primary='<script>alert(1)</script>';const html=lowerThirdHtml(validateMotionSelection(x,12));assert.ok(!html.includes(x.text.primary));assert.match(html,/textContent/);assert.doesNotMatch(html,/@font-face|https?:|<img/);
});
test('fixture model returns a validated structured lower-third selection without renderer or network',async()=>{
 const provider=new FixtureModelProvider(),result=await provider.runMotionSelection(JSON.stringify({source_sequence:'Synthetic shapes source',sequenceDuration:12,approvedSelection:valid()}),'unused');assert.equal(result.value.text.primary,'عنوان عربي');
});
