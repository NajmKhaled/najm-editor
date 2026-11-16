export interface MotionSelection {
  preset:'najm.lower-third.v1';
  text:{primary:string;secondary:string};
  start:number;end:number;fps:24|25|30|60;width:1280|1920|1080;height:720|1080|1920;
  style:{accent:'mint'|'lavender';position:'left'|'right';scale:number};
}
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
export const motionSchema=object({preset:{type:'string',enum:['najm.lower-third.v1']},text:object({primary:{type:'string'},secondary:{type:'string'}}),start:{type:'number'},end:{type:'number'},fps:{type:'integer',enum:[24,25,30,60]},width:{type:'integer',enum:[1280,1920,1080]},height:{type:'integer',enum:[720,1080,1920]},style:object({accent:{type:'string',enum:['mint','lavender']},position:{type:'string',enum:['left','right']},scale:{type:'number'}})});
function keys(value:any,expected:string){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===expected}
export function validateMotionSelection(value:unknown,sequenceDuration:number):MotionSelection{
 const x=value as MotionSelection;
 if(!keys(x,'end,fps,height,preset,start,style,text,width')||x.preset!=='najm.lower-third.v1'||!keys(x.text,'primary,secondary')||!keys(x.style,'accent,position,scale'))throw Error('Invalid lower-third selection or extra fields');
 for(const [name,max] of [['primary',64],['secondary',80]] as const){const text=x.text[name];if(typeof text!=='string'||text.length>max||name==='primary'&&!text.trim()||/[\u0000-\u001f\u007f]/.test(text))throw Error('Invalid lower-third text');}
 if(!Number.isFinite(x.start)||!Number.isFinite(x.end)||x.start<0||x.end>sequenceDuration||x.end-x.start<1||x.end-x.start>8||Math.abs(Math.round(x.start*x.fps)/x.fps-x.start)>.00001||Math.abs(Math.round(x.end*x.fps)/x.fps-x.end)>.00001)throw Error('Lower-third timing must be frame aligned and within the sequence');
 if(![24,25,30,60].includes(x.fps)||![[1280,720],[1920,1080],[1080,1920]].some(([w,h])=>x.width===w&&x.height===h))throw Error('Unsupported lower-third format');
 if(!['mint','lavender'].includes(x.style.accent)||!['left','right'].includes(x.style.position)||!Number.isFinite(x.style.scale)||x.style.scale<.85||x.style.scale>1.15)throw Error('Unapproved lower-third style value');
 return structuredClone(x);
}
/** First-party HTML/CSS only. Text is inserted through textContent, never HTML. */
export function lowerThirdHtml(x:MotionSelection){
 validateMotionSelection(x,x.end);
 return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;font-family:Arial,sans-serif}.lower{position:absolute;${x.style.position}:6%;bottom:12%;max-width:80%;box-sizing:border-box;padding:24px 36px;border-${x.style.position}:8px solid ${x.style.accent==='mint'?'#80efd2':'#b59ae8'};background:rgba(17,23,31,.94);color:#f7f9fc;border-radius:10px;transform-origin:bottom ${x.style.position}}.primary{font-size:${Math.round(x.height*.052*x.style.scale)}px;font-weight:700;line-height:1.25;overflow-wrap:anywhere}.secondary{font-size:${Math.round(x.height*.030*x.style.scale)}px;margin-top:8px;color:#cfdae2;line-height:1.3}</style></head><body><div class="lower"><div class="primary" dir="auto"></div><div class="secondary" dir="auto"></div></div><script>window.setGraphic=function(value){document.querySelector('.primary').textContent=value.primary;document.querySelector('.secondary').textContent=value.secondary};window.renderFrame=function(t,duration){var a=Math.min(1,Math.max(0,t/.35),Math.max(0,(duration-t-1/${x.fps})/.35)),e=1-Math.pow(1-a,3),el=document.querySelector('.lower');el.style.opacity=String(a);el.style.transform='translateX('+((1-e)*${x.style.position==='left'?-70:70}+'px)')};</script></body></html>`;
}
