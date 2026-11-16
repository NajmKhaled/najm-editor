import type {StoryPlan} from './workflow-types.js';

export interface TestSection {start:number;end:number}
export interface ResolvedTestSection extends TestSection {speechStart:number;speechEnd:number;phraseCount:number;before:string;after:string}

export function validateTestSection(value:unknown,duration:number):TestSection {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='start'&&key!=='end'))throw Error('Test section requires start and end seconds');
  const {start,end}=value as Record<string,unknown>;
  if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||!Number.isFinite(duration)||end>duration+.02)throw Error('Test section is outside source sequence boundaries');
  if(end-start<3||end-start>30)throw Error('Test section must be 3 to 30 seconds');
  return {start,end};
}

export function resolveTestSection(section:TestSection,phrases:any[]){
  const included=phrases.filter(p=>Number(p.start)>=section.start-.02&&Number(p.end)<=section.end+.02&&Number(p.end)>Number(p.start)&&String(p.text||'').trim());
  if(!included.length)throw Error('Test section contains no complete narration phrases; adjust its boundaries');
  const speechStart=Number(included[0].start),speechEnd=Number(included.at(-1).end);
  if(speechEnd-speechStart<1)throw Error('Test section has too little complete narration');
  const before=phrases.filter(p=>Number(p.end)<=speechStart&&Number(p.end)>Math.max(0,speechStart-15)).map(p=>String(p.text||'')).join(' ').trim();
  const after=phrases.filter(p=>Number(p.start)>=speechEnd&&Number(p.start)<speechEnd+15).map(p=>String(p.text||'')).join(' ').trim();
  return {phrases:included,context:{...section,speechStart,speechEnd,phraseCount:included.length,before,after} as ResolvedTestSection};
}

/** A prior saved story beat is a timing hint, not a semantic quality judgment. */
export function suggestTestSection(plan:StoryPlan,phrases:any[],duration:number,used:TestSection[]=[]):TestSection|null {
  const beats=(plan?.story_beats||[]).filter(b=>Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>b.start).sort((a,b)=>a.start-b.start);
  for(const beat of beats){
    const candidates=phrases.filter(p=>Number(p.start)>=beat.start-.02&&Number(p.end)<=beat.end+.02&&Number(p.end)>Number(p.start));
    if(!candidates.length)continue;
    const start=Math.max(0,Number(candidates[0].start)-.25),end=Math.min(duration,Number(candidates.at(-1).end)+.25);
    if(end-start>=3&&end-start<=30&&!used.some(section=>Math.max(section.start,start)<Math.min(section.end,end)))return {start,end};
  }
  return null;
}

export function assertStoryInsideTestSection(plan:StoryPlan,section:ResolvedTestSection){
  if(!plan.keep_segments.length||plan.keep_segments.some(s=>s.source_start<section.speechStart-.02||s.source_end>section.speechEnd+.02))throw Error('Story plan keeps narration outside the selected test section');
  if(plan.remove_segments.some(s=>s.source_start<section.speechStart-.02||s.source_end>section.speechEnd+.02))throw Error('Story plan removes narration outside the selected test section');
}
