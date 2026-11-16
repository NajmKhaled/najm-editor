/* Najm V2 owns this host script. It does not load or call the MCP extension. */
var NajmV2 = NajmV2 || {};
(function (api) {
  api.mutationResults = api.mutationResults || {};
  var TICKS = 254016000000;
  function fail(message) { throw new Error(message); }
  function seconds(t) { try { return Number(t.seconds); } catch (_) { return Number(t.ticks) / TICKS; } }
  function ticks(n) { return String(Math.round(Number(n) * TICKS)); }
  function seq(id) { for (var i = 0; i < app.project.sequences.numSequences; i++) { var s = app.project.sequences[i]; if (String(s.sequenceID) === String(id)) return s; } fail('Sequence not found: ' + id); }
  function itemById(parent, id) { if (!parent || !parent.children) return null; for (var i = 0; i < parent.children.numItems; i++) { var x = parent.children[i]; if (String(x.nodeId) === String(id)) return x; var inside = itemById(x, id); if (inside) return inside; } return null; }
  function itemByPath(parent, path) { if (!parent || !parent.children) return null; for (var i = 0; i < parent.children.numItems; i++) { var x = parent.children[i], p = ''; try { p = x.getMediaPath() || ''; } catch (_) {} if (p && p.toLowerCase() === String(path).toLowerCase() && !/^NAJM_MEDIA_(VIDEO|AUDIO)_/.test(String(x.name))) return x; var inside = itemByPath(x, path); if (inside) return inside; } return null; }
  function media(parent, out, bins) { if (!parent || !parent.children) return; bins = bins || []; for (var i = 0; i < parent.children.numItems; i++) { var x = parent.children[i], p = ''; try { p = x.getMediaPath() || ''; } catch (_) {} if (p) out.push({id:String(x.nodeId),name:String(x.name),mediaPath:String(p),binPath:bins,binOrder:i+1}); media(x, out, p ? bins : bins.concat([String(x.name)])); } }
  function importPath(path) { var found = itemByPath(app.project.rootItem, path); if (found) return found; if (!(new File(path)).exists) fail('Media missing: ' + path); if (!app.project.importFiles([path], true, app.project.rootItem, false)) fail('Premiere import failed: ' + path); found = itemByPath(app.project.rootItem, path); if (!found) fail('Imported media cannot be identified by full path: ' + path); return found; }
  function itemByName(parent,name) { if(!parent||!parent.children)return null;for(var i=0;i<parent.children.numItems;i++){var x=parent.children[i];if(String(x.name)===name)return x;var inside=itemByName(x,name);if(inside)return inside;}return null; }
  // Track.overwriteClip can insert BOTH streams. Native single-stream subclips avoid
  // deleting incidental audio, changing master channel mappings, or overwriting picture.
  // Start at source zero so clip in/out values remain absolute source coordinates.
  function mediaPortion(path,kind,sourceEnd) {
    var master=importPath(path),name='NAJM_MEDIA_'+kind+'_'+String(master.nodeId)+'_'+ticks(sourceEnd),portion=itemByName(app.project.rootItem,name);
    if(!portion){if(typeof master.createSubClip!=='function')fail('Premiere cannot isolate '+kind+' for safe source audio preservation');portion=master.createSubClip(name,ticks(0),ticks(sourceEnd),0,kind==='VIDEO'?1:0,kind==='AUDIO'?1:0);}
    if(!portion||String(portion.getMediaPath()).toLowerCase()!==String(path).toLowerCase())fail('Native '+kind+' subclip source could not be verified');
    return portion;
  }
  function clipPath(c) { try { return String(c.projectItem.getMediaPath() || ''); } catch (_) { return ''; } }
  function clipInfo(c) { var info = {id:String(c.nodeId),name:String(c.name),projectItemId:c.projectItem ? String(c.projectItem.nodeId) : '',mediaPath:clipPath(c),start:seconds(c.start),end:seconds(c.end),sourceIn:seconds(c.inPoint),sourceOut:seconds(c.outPoint)}; try { info.enabled=!!c.isEnabled(); } catch (_) { info.enabled=null; } try { info.graphic = graphicInfo(c); } catch (_) {} return info; }
  function tracks(group) { var result = []; for (var t = 0; t < group.numTracks; t++) { var row = {index:t,clips:[],muted:null};try{row.muted=!!group[t].isMuted();}catch(_){} for (var c = 0; c < group[t].clips.numItems; c++) row.clips.push(clipInfo(group[t].clips[c])); result.push(row); } return result; }
  function snapshot(s) { var settings=null; try { settings=s.getSettings(); } catch (_) {} var video=tracks(s.videoTracks),audio=tracks(s.audioTracks),duration=0,groups=[video,audio]; for(var g=0;g<groups.length;g++)for(var t=0;t<groups[g].length;t++)for(var c=0;c<groups[g][t].clips.length;c++){var end=Number(groups[g][t].clips[c].end);if(isFinite(end)&&end>duration)duration=end;} var sequenceEnd=NaN;try{sequenceEnd=seconds(s.end);}catch(_){}if(isFinite(sequenceEnd)&&sequenceEnd>duration)duration=sequenceEnd;var fps=TICKS/Number(s.timebase);return {id:String(s.sequenceID),name:String(s.name),duration:duration,sequenceFps:isFinite(fps)?fps:null,width:settings?Number(settings.videoFrameWidth)||null:null,height:settings?Number(settings.videoFrameHeight)||null:null,videoTracks:video,audioTracks:audio}; }
  function referenceSnapshot(s) { var result=snapshot(s),groups=[[s.videoTracks,result.videoTracks],[s.audioTracks,result.audioTracks]]; for(var g=0;g<groups.length;g++){var original=groups[g][0],rows=groups[g][1];for(var t=0;t<rows.length;t++)for(var c=0;c<rows[t].clips.length;c++){var clip=original[t].clips[c],names=[],details=[];try{if(clip.components)for(var k=0;k<clip.components.numItems&&k<32;k++){var component=clip.components[k],label=String(component.displayName||'').replace(/[\r\n\t]/g,' ').substring(0,64),match='';try{match=String(component.matchName||'').substring(0,100)}catch(_){}if(label)names.push(label);var props=[];try{if(component.properties)for(var j=0;j<component.properties.numItems&&j<32;j++){var prop=component.properties[j],row={name:String(prop.displayName||'').substring(0,80)},value;try{value=prop.getValue();if(typeof value==='number'&&isFinite(value)||typeof value==='boolean'||typeof value==='string'&&value.length<=120)row.value=value}catch(_){}try{if(prop.isTimeVarying&&prop.isTimeVarying()){var keys=prop.getKeys();row.keyframeCount=keys?keys.length:0}}catch(_){}props.push(row)}}catch(_){}details.push({name:label,matchName:match||null,properties:props})}}catch(_){}rows[t].clips[c].componentNames=names;rows[t].clips[c].components=details}}return result; }
  function requireTarget(args) { var s = seq(args.sequenceId); if (!/^NAJM_(EDIT|TEST)_\d+$/.test(String(s.name))) fail('Mutation requires a generated NAJM_EDIT or NAJM_TEST sequence'); if (String(args.sourceSequenceId) === String(s.sequenceID)) fail('Source and target sequence identities are equal'); var receipt=readReceipt(args.targetReceiptPath);if(!args.runId||!receipt||!receipt.initialized||receipt.runId!==args.runId||receipt.sequenceId!==String(s.sequenceID)||receipt.sourceSequenceId!==String(args.sourceSequenceId)||receipt.projectPath!==String(app.project.path||'')||receipt.name!==String(s.name))fail('RECOVERY_REQUIRED: target ownership differs; no timeline changed');return s; }
  function at(track, time) { for (var i = 0; i < track.clips.numItems; i++) if (Math.abs(seconds(track.clips[i].start) - time) < 0.04) return track.clips[i]; return null; }
  function ensureTracks(s, videoCount, audioCount) {
    var addVideo=Math.max(0,videoCount-s.videoTracks.numTracks),addAudio=Math.max(0,audioCount-s.audioTracks.numTracks);
    if (!addVideo && !addAudio) return;
    var priorVideo=tracks(s.videoTracks),priorAudio=tracks(s.audioTracks);
    app.project.openSequence(String(s.sequenceID)); app.enableQE(); var q=qe.project.getActiveSequence();
    if (!q || String(q.guid)!==String(s.sequenceID) || typeof q.addTracks!=='function') fail('Cannot append tracks to the generated sequence');
    // Append after the last existing track. Never insert ahead of an editor-owned track.
    q.addTracks(addVideo,s.videoTracks.numTracks-1,addAudio,1,s.audioTracks.numTracks-1);
    if(s.videoTracks.numTracks<videoCount||s.audioTracks.numTracks<audioCount)fail('Premiere did not append the required tracks');
    if(JSON.stringify(tracks(s.videoTracks).slice(0,priorVideo.length))!==JSON.stringify(priorVideo)||JSON.stringify(tracks(s.audioTracks).slice(0,priorAudio.length))!==JSON.stringify(priorAudio))fail('Premiere shifted existing tracks; refusing clip placement');
  }
  function place(track, projectItem, start, sourceIn, sourceOut) { if (sourceIn !== null && sourceOut !== null) { projectItem.setInPoint(sourceIn, 4); projectItem.setOutPoint(sourceOut, 4); } track.overwriteClip(projectItem, start); var c = at(track, start); if (!c || String(c.projectItem.nodeId) !== String(projectItem.nodeId)) fail('Placement readback failed at ' + start); return c; }
  function textProperties(c) { var comp = null, out = []; try { comp = c.getMGTComponent(); } catch (_) {} if (comp && comp.properties) for (var i = 0; i < comp.properties.numItems; i++) out.push(comp.properties[i]); if (c.components) for (var j = 0; j < c.components.numItems; j++) { var component = c.components[j]; if (!component.properties) continue; for (var k = 0; k < component.properties.numItems; k++) out.push(component.properties[k]); } return out; }
  function textObject(prop) { var raw = String(prop.getValue()), brace = raw.indexOf('{'); if (brace < 0) return null; try { return {prefix:raw.substring(0,brace),obj:JSON.parse(raw.substring(brace))}; } catch (_) { return null; } }
  function textValue(obj) { if (obj.mTextParam && obj.mTextParam.mStyleSheet && obj.mTextParam.mStyleSheet.mText !== undefined) return String(obj.mTextParam.mStyleSheet.mText); if (obj.textEditValue !== undefined) return String(obj.textEditValue); if (obj.mTextString !== undefined) return String(obj.mTextString); return ''; }
  function hasTextField(o) { return !!(o && (o.mTextParam && o.mTextParam.mStyleSheet && o.mTextParam.mStyleSheet.mText !== undefined || o.textEditValue !== undefined || o.mTextString !== undefined)); }
  function graphicInfo(c) { var props = textProperties(c), hits = []; for (var i = 0; i < props.length; i++) { var parsed = textObject(props[i]), name = String(props[i].displayName); if (parsed && hasTextField(parsed.obj)) hits.push({property:name,text:textValue(parsed.obj)}); else if (name === 'Source Text') { var raw = String(props[i].getValue()); if (raw.length > 1) hits.push({property:name,text:raw}); } } return hits; }
  function trim(c, end) { var old = seconds(c.end), time = new Time(); time.ticks = ticks(end); c.end = time; if (Math.abs(seconds(c.end) - end) > 0.06) fail('MOGRT trim failed: expected ' + end + ', actual ' + seconds(c.end) + ', prior ' + old); }
  function renderFrame(s, atSeconds, outputPath) { if (String(app.project.activeSequence.sequenceID) !== String(s.sequenceID)) app.project.openSequence(String(s.sequenceID)); try { app.project.activeSequence = s; } catch (_) {} try { if (s.openInTimeline) s.openInTimeline(); } catch (_) {} $.sleep(250); if (String(app.project.activeSequence.sequenceID) !== String(s.sequenceID)) fail('Render target activation failed'); app.enableQE(); var q = null, count = 0; try { count = qe.project.numSequences; } catch (_) {} for (var qi = 0; qi < count && !q; qi++) { try { var candidate = qe.project.getSequenceAt(qi); if (candidate && String(candidate.guid) === String(s.sequenceID)) q = candidate; } catch (_) {} } if (!q) { var activeQ = qe.project.getActiveSequence(); if (activeQ && String(activeQ.guid) === String(s.sequenceID)) q = activeQ; } if (!q || typeof q.exportFramePNG !== 'function') fail('QE could not address generated sequence by ID for frame export'); var fps = 30; try { fps = Math.round(TICKS / Number(s.timebase)); } catch (_) {} if (!isFinite(fps) || fps < 1 || fps > 120) fps = 30; var f = Math.round(Number(atSeconds) * fps), whole = Math.floor(f / fps), frame = f % fps; function two(n) { return ('0' + n).slice(-2); } var code = two(Math.floor(whole / 3600)) + ':' + two(Math.floor(whole / 60) % 60) + ':' + two(whole % 60) + ':' + two(frame); var stem = String(outputPath).replace(/\.png$/i, ''), written = new File(stem + '.png'); if (written.exists) fail('Rendered frame path already exists: ' + written.fsName); try { q.exportFramePNG(code, stem); } catch (e) { fail('Premiere frame export failed: ' + e); } if (!written.exists || written.length < 100) fail('Premiere frame export wrote no image at ' + written.fsName); return {path:String(written.fsName),time:Number(atSeconds),timecode:code,bytes:written.length,sequenceGuid:String(q.guid)}; }
  function readReceipt(path){if(!path)return null;var f=new File(path);if(!f.exists)return null;if(!f.open('r'))fail('Cannot read target receipt');var text=f.read();f.close();try{return JSON.parse(text)}catch(_){fail('RECOVERY_REQUIRED: corrupt target receipt')}}
  function writeReceipt(path,value){if(!path)fail('Target receipt path required');var f=new File(path),temp=new File(path+'.tmp');if(!temp.open('w'))fail('Cannot persist target ownership');temp.encoding='UTF-8';temp.write(JSON.stringify(value));temp.close();if(f.exists&&!f.remove())fail('Cannot replace target receipt');if(!temp.rename(f.name))fail('Cannot commit target receipt');}
  function verifyTrack(track,expected){for(var i=0;i<track.clips.numItems;i++){var c=track.clips[i],found=false;for(var j=0;j<expected.length;j++){var x=expected[j];if(Math.abs(seconds(c.start)-x.start)<.02&&Math.abs(seconds(c.end)-x.end)<.08&&clipPath(c).toLowerCase()===String(x.mediaPath).toLowerCase()&&Math.abs(seconds(c.inPoint)-x.sourceIn)<.08&&Math.abs(seconds(c.outPoint)-x.sourceOut)<.08){found=true;break;}}if(!found)fail('RECOVERY_REQUIRED: existing clip differs from this run; preserve manual edits and review the target');}}
  function graphicBatch(s,list,trackIndex,kind,args) {
    var track=s.videoTracks[trackIndex];if(!track)fail('Graphics track missing');try{if(track.isMuted())fail('Graphics track is muted; review target')}catch(error){if(String(error).indexOf('muted')>=0)throw error;}
    var out=[];
    for(var i=0;i<list.length;i++){
      var x=list[i],path=String(x.templatePath||''),owner='NAJM_'+args.runId+'_'+kind+'_'+i+'_'+(new File(path)).name,c=at(track,Number(x.start));
      if(c){if(String(c.name)!==owner||Math.abs(seconds(c.end)-x.end)>.08)fail('RECOVERY_REQUIRED: graphic conflicts with an existing or edited clip');if(/\.png$/i.test(path)){if(clipPath(c).toLowerCase()!==path.toLowerCase())fail('Graphic media differs')}else{var readable=graphicInfo(c),joined='';for(var p=0;p<readable.length;p++)joined+=readable[p].text;if(!joined||joined.replace(/\s/g,'')!==String(x.text).replace(/\s/g,''))fail('RECOVERY_REQUIRED: native graphic text cannot be verified');}}
      else if(args.batchStart===undefined||i>=args.batchStart&&i<args.batchEnd){
        if(/\.png$/i.test(path)){c=place(track,importPath(path),Number(x.start),0,Number(x.end)-Number(x.start));trim(c,Number(x.end));}
        else{c=s.importMGT(path,ticks(x.start),trackIndex,0);if(!c)fail('Native graphic import failed');trim(c,Number(x.end));}
        c.name=owner;
      }
      if(c){try{if(!c.isEnabled())fail('Graphic clip is disabled')}catch(error){if(String(error).indexOf('disabled')>=0)throw error;}out.push({id:String(c.nodeId),start:seconds(c.start),end:seconds(c.end),text:String(x.text),template:path,kind:kind});}
    }
    return out;
  }
  api.dispatch = function (payload) { var request; try { request = JSON.parse(payload); var op = request.operation, a = request.args || {}, result, s, i, c; if(a.operationKey&&api.mutationResults[a.operationKey]){var memo=api.mutationResults[a.operationKey];if(memo.projectPath!==String(app.project.path||''))fail('RECOVERY_REQUIRED: project changed');return JSON.stringify({ok:true,result:memo.result});}
    if (op === 'health') result = {connected:true,host:'Premiere ExtendScript',projectPath:app.project.path || ''};
    else if (op === 'getActiveSequenceState' || op === 'getProjectState') { var active = app.project.activeSequence, items = [], sequences = []; for (i = 0; i < app.project.sequences.numSequences; i++) { s = app.project.sequences[i]; var vc = 0, ac = 0; try { for (var vt = 0; vt < s.videoTracks.numTracks; vt++) vc += s.videoTracks[vt].clips.numItems; for (var audioTrackIndex = 0; audioTrackIndex < s.audioTracks.numTracks; audioTrackIndex++) ac += s.audioTracks[audioTrackIndex].clips.numItems; } catch (_) {} sequences.push({id:String(s.sequenceID),name:String(s.name),videoClipCount:vc,audioClipCount:ac}); } if (op === 'getProjectState') media(app.project.rootItem, items); result = {projectPath:String(app.project.path || ''),activeSequence:active ? {id:String(active.sequenceID),name:String(active.name)} : null,sequences:sequences}; if (op === 'getProjectState') result.media = items; }
    else if (op === 'getSequenceSnapshot' || op === 'readSequenceSnapshot') result = snapshot(seq(a.sequenceId));
    else if (op === 'getReferenceSnapshot') result = referenceSnapshot(seq(a.sequenceId));
    else if (op === 'activateSourceSequence' || op === 'openGeneratedSequence') { s = seq(a.sequenceId); if (op === 'activateSourceSequence' && /^NAJM_(EDIT|TEST)_\d+$/.test(String(s.name))) fail('Generated edit cannot be activated as a source'); if (op === 'openGeneratedSequence' && !/^NAJM_(EDIT|TEST)_\d+$/.test(String(s.name))) fail('Only a generated edit can be opened'); app.project.openSequence(String(s.sequenceID)); var opened = app.project.activeSequence; if (!opened || String(opened.sequenceID) !== String(s.sequenceID)) fail('Sequence activation readback failed'); result = {id:String(opened.sequenceID),name:String(opened.name)}; }
    else if (op === 'inspectGraphicAt') { s = requireTarget(a); var inspectTrack = s.videoTracks[Number(a.trackIndex)]; if (!inspectTrack) fail('Graphic track not found'); c = at(inspectTrack,Number(a.start)); if (!c) fail('Graphic clip not found'); var gp = textProperties(c), details = [], muted = null, enabled = null; try { muted = !!inspectTrack.isMuted(); } catch (_) {} try { enabled = !!c.isEnabled(); } catch (_) {} for (i = 0; i < gp.length; i++) { var raw = ''; try { raw = String(gp[i].getValue()); } catch (_) {} details.push({property:String(gp[i].displayName),length:raw.length,preview:raw.substring(0,180),firstChar:raw.length ? raw.charCodeAt(0) : null}); } result = {trackIndex:Number(a.trackIndex),trackMuted:muted,clipEnabled:enabled,start:seconds(c.start),end:seconds(c.end),properties:details}; }
    else if (op === 'exportGeneratedFrame') { s = requireTarget(a); result = renderFrame(s,a.time,a.outputPath); }
    else if (op === 'createSourceAssembly') {
      s = seq(a.referenceSequenceId);
      if (!/^NAJM_SOURCE_\d+$/.test(String(a.name)) || !a.narrationPath || !a.videos || !a.videos.length || a.videos.length > 200) fail('Invalid source assembly request');
      if (!(new File(String(a.narrationPath))).exists) fail('Narration media is offline');
      for (i = 0; i < a.videos.length; i++) if (!(new File(String(a.videos[i].path))).exists || !(Number(a.videos[i].duration) >= 0.6)) fail('Source video is missing or too short: ' + i);
      var sourceIds = {}, sourceCount = app.project.sequences.numSequences;
      for (i = 0; i < sourceCount; i++) { sourceIds[String(app.project.sequences[i].sequenceID)] = true; if (String(app.project.sequences[i].name) === String(a.name)) fail('Source assembly name already exists'); }
      var sourceClone = s.clone(), assembled = null, newSequences = [];
      for (var sourceAttempt = 0; sourceAttempt < 20 && !assembled; sourceAttempt++) {
        try { var returnedSource = sourceClone && sourceClone.getSequence ? sourceClone.getSequence() : sourceClone && sourceClone.videoTracks ? sourceClone : null; if (returnedSource && !sourceIds[String(returnedSource.sequenceID)]) assembled = returnedSource; } catch (_) {}
        newSequences = [];
        for (i = 0; i < app.project.sequences.numSequences; i++) { var candidateSource = app.project.sequences[i]; if (!sourceIds[String(candidateSource.sequenceID)]) newSequences.push(candidateSource); }
        if (!assembled && newSequences.length === 1) assembled = newSequences[0];
        if (!assembled) $.sleep(100);
      }
      if (!assembled || String(assembled.sequenceID) === String(s.sequenceID) || sourceIds[String(assembled.sequenceID)]) fail('Source clone identity could not be verified; no clips cleared');
      assembled.name = a.name;
      for (var sg = 0; sg < 2; sg++) { var sourceGroup = sg ? assembled.audioTracks : assembled.videoTracks; for (var st = 0; st < sourceGroup.numTracks; st++) { for (var sn = sourceGroup[st].clips.numItems - 1; sn >= 0; sn--) sourceGroup[st].clips[sn].remove(false,false); if (sourceGroup[st].clips.numItems) fail('Source assembly clone could not be cleared'); } }
      if (!assembled.videoTracks[0] || !assembled.audioTracks[0]) fail('Source assembly requires V1 and A1');
      var sourcePosition = 0;
      for (i = 0; i < a.videos.length; i++) { var sourceVideo = a.videos[i], sourceItem = itemByPath(app.project.rootItem,sourceVideo.path), sampleDuration = Math.min(1,Number(sourceVideo.duration) - 0.1); if (!sourceItem) fail('Source media item missing from project: ' + sourceVideo.path); place(assembled.videoTracks[0],sourceItem,sourcePosition,0,sampleDuration); sourcePosition += sampleDuration; }
      for (var sa = 0; sa < assembled.audioTracks.numTracks; sa++) for (var sc = assembled.audioTracks[sa].clips.numItems - 1; sc >= 0; sc--) assembled.audioTracks[sa].clips[sc].remove(false,false);
      var narrationItem = itemByPath(app.project.rootItem,a.narrationPath); if (!narrationItem) fail('Narration item missing from project');
      place(assembled.audioTracks[0],narrationItem,0,0,Number(a.narrationDuration));
      result = {sequenceId:String(assembled.sequenceID),name:String(assembled.name),snapshot:snapshot(assembled)};
      if (!result.snapshot.videoTracks[0].clips.length || !result.snapshot.audioTracks[0].clips.length) fail('Source assembly readback is empty');
    }
    else if (op === 'createGeneratedSequence') {
      s = seq(a.sourceSequenceId);
      if (/^NAJM_(EDIT|TEST)_/.test(String(s.name))) fail('Generated sequence cannot be a source'); if (!/^NAJM_(EDIT|TEST)_\d+$/.test(String(a.name))) fail('Invalid generated sequence name');
      var priorIds = {}, priorCount = app.project.sequences.numSequences;
      for (i = 0; i < priorCount; i++) { priorIds[String(app.project.sequences[i].sequenceID)] = true; if (String(app.project.sequences[i].name) === String(a.name)) fail('Generated name already exists: ' + a.name); }
      var cloned = s.clone(), target = null, created = [];
      for (var attempt = 0; attempt < 20 && !target; attempt++) {
        try { var returned = cloned && cloned.getSequence ? cloned.getSequence() : cloned && cloned.videoTracks ? cloned : null; if (returned && !priorIds[String(returned.sequenceID)]) target = returned; } catch (_) {}
        created = [];
        for (i = 0; i < app.project.sequences.numSequences; i++) { var candidate = app.project.sequences[i]; if (!priorIds[String(candidate.sequenceID)]) created.push(candidate); }
        if (!target && created.length === 1) target = created[0];
        if (!target) { var activeCandidate = app.project.activeSequence; if (activeCandidate && !priorIds[String(activeCandidate.sequenceID)]) target = activeCandidate; }
        if (!target) $.sleep(100);
      }
      if (!target || String(target.sequenceID) === String(s.sequenceID) || priorIds[String(target.sequenceID)]) fail('Clone identity could not be verified; no clips cleared; before=' + priorCount + ', after=' + app.project.sequences.numSequences + ', new=' + created.length + ', return=' + typeof cloned);
      target.name = a.name;
      var receipt={runId:a.runId,sequenceId:String(target.sequenceID),name:String(a.name),sourceSequenceId:String(s.sequenceID),projectPath:String(app.project.path||''),initialized:false,preserveTimeline:!!a.preserveTimeline};writeReceipt(a.targetReceiptPath,receipt);
      if (cloned && cloned.name !== undefined) cloned.name = a.name;
      if (!a.preserveTimeline) for (var g = 0; g < 2; g++) { var group = g ? target.audioTracks : target.videoTracks; for (var t = 0; t < group.numTracks; t++) { for (var n = group[t].clips.numItems - 1; n >= 0; n--) group[t].clips[n].remove(false, false); if (group[t].clips.numItems) fail('Generated clone could not be cleared on track ' + t); } }
      receipt.initialized=true;writeReceipt(a.targetReceiptPath,receipt);
      result = {sequenceId:String(target.sequenceID),name:String(target.name),sourceSequenceId:String(s.sequenceID),preserveTimeline:!!a.preserveTimeline,snapshot:snapshot(target)};
    }
    else if (op === 'buildRoughCutBatch') {
      s = requireTarget(a); if (!a.cleanNarrationPath || !a.shots || !a.shots.length || !a.sourceAudio) fail('Rough cut requires narration, picture and a source audio plan');
      var audioCount=1;for(i=0;i<a.sourceAudio.length;i++){var ap=a.sourceAudio[i];if(!(ap.trackIndex>=1)||ap.end<=ap.start||ap.sourceOut<=ap.sourceIn)fail('Invalid preserved source audio');audioCount=Math.max(audioCount,Number(ap.trackIndex)+1);}
      ensureTracks(s,1,audioCount);var placed=[],sound=[],picture=[];
      for(i=0;i<a.shots.length;i++)picture.push({mediaPath:a.shots[i].source_media,start:a.shots[i].timeline_start,end:a.shots[i].timeline_end,sourceIn:a.shots[i].source_in,sourceOut:a.shots[i].source_out});verifyTrack(s.videoTracks[0],picture);
      var narrationDuration=0;for(i=0;i<a.shots.length;i++)narrationDuration=Math.max(narrationDuration,a.shots[i].timeline_end);
      verifyTrack(s.audioTracks[0],[{mediaPath:a.cleanNarrationPath,start:0,end:narrationDuration,sourceIn:0,sourceOut:narrationDuration}]);
      for(var ti=1;ti<s.audioTracks.numTracks;ti++){var expected=[];for(i=0;i<a.sourceAudio.length;i++)if(a.sourceAudio[i].trackIndex===ti)expected.push(a.sourceAudio[i]);verifyTrack(s.audioTracks[ti],expected);}

      for(i=a.batchStart||0;i<Math.min(a.shots.length,a.batchEnd===undefined?a.shots.length:a.batchEnd);i++){var shot=a.shots[i],start=Number(shot.timeline_start),mediaItem=null;c=at(s.videoTracks[0],start);if(c){if(clipPath(c).toLowerCase()!==String(shot.source_media).toLowerCase()||Math.abs(seconds(c.inPoint)-shot.source_in)>.08||Math.abs(seconds(c.end)-shot.timeline_end)>.08)fail('Existing shot conflicts: '+shot.shot_id)}else c=place(s.videoTracks[0],mediaPortion(shot.source_media,'VIDEO',shot.source_out),start,shot.source_in,shot.source_out);placed.push(clipInfo(c));}
      var narration=importPath(a.cleanNarrationPath),audio=at(s.audioTracks[0],0);if(audio){if(clipPath(audio).toLowerCase()!==String(a.cleanNarrationPath).toLowerCase())fail('A1 contains unexpected audio')}else audio=place(s.audioTracks[0],narration,0,null,null);if(typeof s.audioTracks[0].setMute==='function')s.audioTracks[0].setMute(0);
      for(i=a.batchStart||0;i<Math.min(a.sourceAudio.length,a.batchEnd===undefined?a.sourceAudio.length:a.batchEnd);i++){var x=a.sourceAudio[i],audioTrack=s.audioTracks[x.trackIndex];if(typeof audioTrack.setMute==='function')audioTrack.setMute(0);c=at(audioTrack,x.start);if(c){if(clipPath(c).toLowerCase()!==String(x.mediaPath).toLowerCase()||Math.abs(seconds(c.inPoint)-x.sourceIn)>.08||Math.abs(seconds(c.end)-x.end)>.08)fail('Preserved source audio conflicts: '+x.id)}else c=place(audioTrack,mediaPortion(x.mediaPath,'AUDIO',x.sourceOut),x.start,x.sourceIn,x.sourceOut);sound.push(clipInfo(c));}
      result={sequenceId:String(s.sequenceID),shots:placed,audio:clipInfo(audio),sourceAudio:sound,snapshot:snapshot(s)};
    }
    else if(op==='applyGraphicsBatch'){
      s=requireTarget(a);if(!a.captions||!a.captions.length||!a.title)fail('Caption and title plan required');
      var titleTrack=Number(a.titleTrackIndex),captionTrack=Number(a.captionTrackIndex);if(!(titleTrack>=1)||captionTrack!==titleTrack+1)fail('Explicit graphics tracks required');
      if(a.preserveTimeline&&titleTrack<seq(a.sourceSequenceId).videoTracks.numTracks)fail('Graphics must append after existing tracks');
      var planned=a.captions.concat([a.title]);for(i=0;i<planned.length;i++)if(!(new File(String(planned[i].templatePath||''))).exists)fail('Graphic asset missing');
      ensureTracks(s,captionTrack+1,s.audioTracks.numTracks);
      // Preflight both tracks before importing anything. Never clear a graphics track.
      var lists=[a.captions,[a.title]],indices=[captionTrack,titleTrack],kinds=['caption','title'];
      for(var g=0;g<2;g++){var track=s.videoTracks[indices[g]];for(var ci=0;ci<track.clips.numItems;ci++){var existing=track.clips[ci],owned=false;for(var li=0;li<lists[g].length;li++){var item=lists[g][li],owner='NAJM_'+a.runId+'_'+kinds[g]+'_'+li+'_'+(new File(item.templatePath)).name;if(String(existing.name)===owner&&Math.abs(seconds(existing.start)-item.start)<.02&&Math.abs(seconds(existing.end)-item.end)<.08)owned=true;}if(!owned)fail('RECOVERY_REQUIRED: unrelated or modified graphic; nothing removed');}}
      result={captions:graphicBatch(s,a.captions,captionTrack,'caption',a),title:graphicBatch(s,[a.title],titleTrack,'title',a),titleTrackIndex:titleTrack,captionTrackIndex:captionTrack,snapshot:snapshot(s)};
    }
    else if (op === 'saveProject') { app.project.save(); result = {saved:true,projectPath:String(app.project.path || '')}; }
    else fail('Unknown Najm V2 operation: ' + op);
    if (a.operationKey && /^(createSourceAssembly|createGeneratedSequence|exportGeneratedFrame)$/.test(op)) api.mutationResults[a.operationKey] = {projectPath:String(app.project.path||''),result:result};
    return JSON.stringify({ok:true,result:result});
  } catch (error) { return JSON.stringify({ok:false,error:String(error)}); } };
})(NajmV2);
