import {resolve} from 'node:path';import {FixtureModelProvider} from '../packages/v2/fixture-model.js';
import {renderLowerThird} from '../packages/v2/motion-renderer.js';
const input={source_sequence:'Synthetic shapes source',sequenceDuration:12,approvedSelection:{preset:'najm.lower-third.v1',text:{primary:'حكاية الأشكال',secondary:'Original local lower third'},start:1,end:3,fps:24,width:1280,height:720,style:{accent:'mint',position:'left',scale:1}}};
const result=await new FixtureModelProvider().runMotionSelection(JSON.stringify(input),'unused');
const rendered=await renderLowerThird(result.value,12,resolve('demo/output/lower-third'));
console.log(JSON.stringify({preset:result.value.preset,graphicsKind:'RENDERED_OVERLAY_NOT_EDITABLE_MOGRT',verification:rendered.verification,output:'demo/output/lower-third/'},null,2));
