import {win32} from 'node:path';

export interface SourceAssetContext {
  mediaPath:string;
  fileName:string;
  premiereName:string;
  physicalFolders:string[];
  premiereBins:string[];
  filenameOrdinal?:number;
  folderOrdinals:(number|null)[];
  projectBinOrder?:number;
  sourceTimelineOrder:number;
  sourceTimelinePositions:number[];
  firstTimelineStartMs:number;
  videoTracks:number[];
}
export interface SourceMediaContext {sequenceName:string;assets:SourceAssetContext[]}

const videoFile=(path:string)=>/\.(mp4|mov|mxf|avi|mkv|webm|mts|m2ts)$/i.test(path);
const key=(path:string)=>path.replace(/\//g,'\\').toLowerCase();

/** A leading number is a label hint, never an instruction to force that edit order. */
export function labelOrdinal(label:string):number|undefined {
  const match=label.match(/^\s*([0-9\u0660-\u0669\u06f0-\u06f9]{1,6})(?=\s|[-_.ـ)\]]|$)/u);
  if(!match)return;
  const digits=[...match[1]].map(c=>{const n=c.codePointAt(0)!;return n>=0x660&&n<=0x669?n-0x660:n>=0x6f0&&n<=0x6f9?n-0x6f0:n-48});
  const value=Number(digits.join(''));
  return Number.isSafeInteger(value)?value:undefined;
}

/** Match project labels to media actually present on the selected source sequence. */
export function buildSourceMediaContext(snapshot:any,projectMedia:any[]):SourceMediaContext {
  const items=new Map<string,any>();
  for(const item of projectMedia||[]){
    const path=String(item.mediaPath||'');if(!path)continue;
    const prior=items.get(key(path));
    if(!prior||!prior.binPath?.length&&item.binPath?.length)items.set(key(path),item);
  }
  const clips=(snapshot.videoTracks||[]).flatMap((track:any)=>(track.clips||[]).map((clip:any,index:number)=>({clip,track:Number(track.index)||0,index})))
    .filter(({clip}:any)=>videoFile(String(clip.mediaPath||'')))
    .sort((a:any,b:any)=>Number(a.clip.start)-Number(b.clip.start)||a.track-b.track||a.index-b.index);
  const assets:SourceAssetContext[]=[],byPath=new Map<string,SourceAssetContext>();
  for(let position=0;position<clips.length;position++){
    const {clip,track}=clips[position],mediaPath=String(clip.mediaPath),identity=key(mediaPath);
    let asset=byPath.get(identity);
    if(!asset){
      const item=items.get(identity),fileName=win32.basename(mediaPath),physicalFolders=win32.dirname(mediaPath).split(/[\\/]+/).filter(x=>x&&!/^[a-z]:$/i.test(x)).slice(-6);
      const premiereBins=Array.isArray(item?.binPath)?item.binPath.map(String).filter(Boolean):[];
      asset={mediaPath,fileName,premiereName:String(item?.name||clip.name||fileName),physicalFolders,premiereBins,
        filenameOrdinal:labelOrdinal(fileName),folderOrdinals:physicalFolders.map(x=>labelOrdinal(x)??null),
        projectBinOrder:Number.isInteger(item?.binOrder)?item.binOrder:undefined,
        sourceTimelineOrder:assets.length+1,sourceTimelinePositions:[],firstTimelineStartMs:Math.round(Number(clip.start)*1000),videoTracks:[]};
      assets.push(asset);byPath.set(identity,asset);
    }
    asset.sourceTimelinePositions.push(position+1);
    if(!asset.videoTracks.includes(track))asset.videoTracks.push(track);
  }
  return {sequenceName:String(snapshot.name||''),assets};
}

/** Keep local paths out of model prompts; candidate IDs remain the execution authority. */
export function editorialAssetLabel(asset:SourceAssetContext){
  if(process.env.NAJM_INCLUDE_SOURCE_LABELS!=='1')return {name:'source asset',sourceTimelineOrder:asset.sourceTimelineOrder};
  return {name:asset.fileName,premiereName:asset.premiereName,physicalFolders:asset.physicalFolders,premiereBins:asset.premiereBins,
    filenameOrdinal:asset.filenameOrdinal??null,folderOrdinals:asset.folderOrdinals,projectBinOrder:asset.projectBinOrder??null,
    sourceTimelineOrder:asset.sourceTimelineOrder,sourceTimelinePositions:asset.sourceTimelinePositions,
    firstTimelineStartMs:asset.firstTimelineStartMs,videoTracks:asset.videoTracks};
}
