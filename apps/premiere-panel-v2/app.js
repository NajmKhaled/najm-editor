(function(){'use strict';
var base='http://127.0.0.1:47842';
function sessionToken(){var root=window.NAJM_V2_CONFIG&&window.NAJM_V2_CONFIG.root;if(!root)throw Error('Install the V2 panel first');return require('fs').readFileSync(root+'/config/session-token','utf8').trim()}
var socket=null,queue=[],busy=false,connected=false,engineOnline=false,engineAttempts=0;
var source=null,referenceSequence=null,job=null,usage=null,cachePlan=null,ready=false,health=null,projectSnapshot=null,stageInfo=null;
var statusRequest=0,healthRequest=0,healthBusy=false,statusBusy=false,reconnectTimer=null,engineStartAt=0,sourceListAt=0,acting=false,healthAt=0,statusAt=0,connectionEpoch=0;
var briefDraft='',briefSourceId=null,sourceIdentity='',currentProjectPath='',bootAt=Date.now(),actionFailure='';
var setupLabel='Opening Premiere Direct',setupSince=Date.now(),setupPending=true,setupHistory=[];
var agents=[],agentsLoaded=false,agentLoading=false,agentBusy=false,agentEditorId=null,agentEditorVersion=null,selectedAgentId='',loadedAgentId='',loadedAgentVersion=0,loadedProjectPath='';
var referenceReport=null,referenceBusy=false;
var agentLoadProgress=null,trainingTestResult=null,trainingSession=null,trainingBusy=false,trainingLearning=false,trainingCancelling=false,trainingOperation='',agentCompatibility=null,trainingAgentId='',trainingAt=0,trainingSessionProjectMatches=true,modifyingStyle=false;
try{selectedAgentId=window.localStorage&&window.localStorage.getItem('najm-v2-agent-id')||''}catch(_){}
var stageNames=['Understanding Project','Cleaning Story','Preparing Narration','Understanding Footage','Planning Edit','Building Timeline','Captions & Title','Final Check','Ready'];
var stageDetails=['Reading source narration','Building the story','Preserving original narration','Reviewing source footage','Matching footage to narration','Creating the timeline','Styling Arabic captions and title','Checking the final edit','Your edit is ready'];

function el(id){return document.getElementById(id)}
function setupProgress(label,pending){
  if(label!==setupLabel||pending!==setupPending){setupLabel=label;setupPending=pending;setupSince=Date.now();setupHistory.push('+'+Math.floor((setupSince-bootAt)/1000)+'s  '+label);if(setupHistory.length>12)setupHistory.shift();el('setup-trace').textContent=setupHistory.join('\n')}
  var seconds=Math.max(0,Math.floor((Date.now()-setupSince)/1000));
  el('setup-progress').textContent=setupLabel+(setupPending?' ('+seconds+'s)':'');
}
function requestLabel(path){return path==='/v2/health'?'Checking local engine, AI, media tools and build':path==='/v2/status'?'Reading active Premiere project and edit status':path==='/v2/source-state'?'Listing source sequences':path.indexOf('/v2/source-snapshot')===0?'Reading source tracks and media':null}
function selectedAgent(){return agents.filter(function(agent){return agent.id===selectedAgentId})[0]||null}
function emptyNarrationTest(run){return !!run&&run.operation==='TEST'&&/Story cleanup selected no speech/.test(String(run.error||run.failure&&run.failure.reason||''))}
function editAgent(agent){agentEditorId=agent&&agent.id||null;agentEditorVersion=agent&&agent.version||null;el('agent-name').value=agent&&agent.name||'';el('agent-description').value=agent&&agent.description||'';el('agent-instructions').value=agent&&agent.instructions||'';el('agent-error').textContent='';el('agent-save-status').textContent='';el('agent-form').open=false}
function clearReference(){referenceReport=null;el('reference-shot-ms').value='';el('reference-message').textContent=''}
function renderReference(){
  var agent=selectedAgent(),running=state()==='RUNNING',canRead=!!agent&&connected&&engineOnline&&!running&&!referenceBusy&&!agentBusy;
  el('reference-analyze').disabled=!canRead;
  el('reference-analyze').textContent=referenceBusy?'Reading current timeline…':'Analyze current timeline';
  el('reference-review').hidden=!referenceReport;
  if(!referenceReport){
    if(agent&&agent.approvedReference&&!el('reference-message').textContent)el('reference-message').textContent='Saved '+(agent.approvedReference.styleMemory?'structural timeline style memory':'pacing preference')+' in draft agent v'+agent.version+'. It applies to future agent TEST planning. Analyze the current timeline to review another reference.';
    return;
  }
  var report=referenceReport.report,observed=report.observed,shot=observed.shotDurationMs,proposal=report.proposed;
  el('reference-observed').textContent='OBSERVED · '+observed.sequence.name+' · '+observed.sequence.durationSeconds+' s · '+(observed.sequence.fps===null?'frame rate unavailable':observed.sequence.fps+' fps')+'\nVideo tracks: '+observed.sequence.videoTrackCount+'; audio tracks: '+observed.sequence.audioTrackCount+'; primary video track: '+observed.primaryVideoTrack+'\nMedia clips: '+observed.shotCount+'; shot duration min/median/max: '+[shot.min,shot.median,shot.max].map(function(x){return x===null?'unavailable':x+' ms'}).join(' / ')+'\nCuts: '+observed.cuts+'; gaps: '+observed.gapCount+'; overlaps: '+observed.overlapCount+'; other-layer clips: '+observed.layeredClipCount+'\nDistinct sources: '+observed.sourceReuse.distinctSources+'; repeated sources: '+observed.sourceReuse.repeatedSources+'; reused placements: '+observed.sourceReuse.reusedClipPlacements+'\nAudio placement by track: '+observed.audioTracks.map(function(x){return 'track '+x.index+': '+x.clipCount+' clips, '+x.occupiedMs+' ms occupied'}).join('; ')+'\nReadable graphic text clips: '+observed.graphicText.clipCount+'; properties: '+(observed.graphicText.readableProperties.join(', ')||'none')+'\nText samples: '+(observed.graphicText.samples.map(function(x){return x.text}).join(' | ')||'none')+'\n'+report.captionPattern.status+' · short graphic text candidates: '+report.captionPattern.candidateCount+'; median words: '+(report.captionPattern.medianWords===null?'unavailable':report.captionPattern.medianWords)+'; median duration: '+(report.captionPattern.medianDurationMs===null?'unavailable':report.captionPattern.medianDurationMs+' ms');
  if(observed.effectComponents)el('reference-observed').textContent+='\n'+observed.effectComponents.status+' · Non-default component candidates: '+observed.effectComponents.clipCount+' clips; names: '+(observed.effectComponents.names.join(', ')||'unavailable')+'. Effect settings are not captured.';
  el('reference-proposal').textContent=proposal?'DERIVED · Proposed visual shot target '+proposal.targetShotDurationMs+' ms ('+proposal.confidence+' confidence). '+proposal.reason:'UNAVAILABLE · At least three primary-track media clips are needed to propose a shot target.';
  var memory=report.styleMemory;
  el('reference-support').textContent=(memory?'DERIVED structural style memory for this agent:\nShot duration middle range: '+memory.pacing.lowerQuartileMs+'–'+memory.pacing.upperQuartileMs+' ms; first 5 s median: '+(memory.pacing.openingFiveSecondsMedianMs===null?'unavailable':memory.pacing.openingFiveSecondsMedianMs+' ms')+'\nOverlay media clips: '+memory.picture.overlayMediaClips+'; Graphic-labeled clips: '+memory.picture.graphicLikeClips+' (median '+(memory.picture.graphicLikeMedianMs===null?'unavailable':memory.picture.graphicLikeMedianMs+' ms')+') on tracks '+(memory.picture.graphicLikeTracks.join(', ')||'none')+'; clips with extra component candidates: '+memory.picture.effectComponentClips+'\nAudio: '+memory.sound.clipCount+' clips on '+memory.sound.trackCount+' tracks; cuts/gaps/overlaps: '+memory.continuity.cuts+'/'+memory.continuity.gaps+'/'+memory.continuity.overlaps+'; reused source placements: '+memory.continuity.reusedPlacements+'\nGraphic labels and component names identify structure, not verified text, design, or effect settings.\n\n':'')+'Supported: '+report.supported.shotPacing+'. '+report.supported.graphicText+'.\nDependencies: caption template '+report.dependencies.captionTemplate+'; title template '+report.dependencies.titleTemplate+'; reference template '+report.dependencies.referenceTemplate+'.\n'+report.unsupported.map(function(x){return x.status+' · '+x.property+': '+x.reason}).join('\n');
  var value=Number(el('reference-shot-ms').value),unchanged=agent&&agent.id===referenceReport.agentId&&agent.version===referenceReport.agentVersion&&el('agent-name').value===agent.name&&el('agent-description').value===agent.description&&el('agent-instructions').value===agent.instructions;
  el('reference-approve').disabled=!canRead||!proposal||!unchanged||!Number.isInteger(value)||value<500||value>10000;
  if(!unchanged)el('reference-message').textContent='Save or discard agent text changes before approving the reference.';
  else if(proposal&&(!Number.isInteger(value)||value<500||value>10000))el('reference-message').textContent='Enter a target shot duration from 500 to 10000 ms to save this style memory.';
}
function refreshTraining(force){var agent=selectedAgent();if(!agent){trainingSession=null;trainingLearning=false;agentCompatibility=null;trainingAgentId='';render();return}if(!force&&trainingAgentId===agent.id&&Date.now()-trainingAt<(trainingBusy?2000:10000))return;trainingAt=Date.now();trainingAgentId=agent.id;request('GET','/v2/training/status?agentId='+encodeURIComponent(agent.id),null,function(error,result){if(selectedAgentId!==agent.id)return;if(error){el('studio-error').textContent=String(error);return}trainingSession=result&&result.session||null;trainingSessionProjectMatches=!!(result&&result.sessionProjectMatches!==false);trainingTestResult=result&&result.testResult||null;trainingLearning=!!(result&&result.learning);agentCompatibility=result&&result.compatibility||null;render()})}
function trainingAction(path,body,done){if(trainingBusy)return;trainingBusy=true;el('studio-error').textContent='';var actionNames={'/v2/training/learn':'Reading the reference timeline and local media','/v2/training/answer':'Saving your reusable style choice','/v2/training/prepare':'Finding footage and preparing an independent TEST','/v2/training/apply':'Starting the isolated agent TEST','/v2/training/update':'Comparing your corrected TEST with the saved baseline','/v2/training/confirm-correction':'Saving the confirmed correction lesson','/v2/training/approve':'Verifying and saving the agent'};trainingOperation=actionNames[path]||'Working in Najm V2';render();request('POST',path,body,function(error,result){trainingBusy=false;trainingCancelling=false;trainingOperation='';if(error){el('studio-error').textContent=String(error);el('studio-operation').textContent='Check the saved training status before retrying.';refreshTraining(true);render();return}if(result&&result.session)trainingSession=result.session;if(result&&result.agent){agents=agents.filter(function(item){return item.id!==result.agent.id});agents.push(result.agent);agentCompatibility=null;renderAgentList();editAgent(result.agent);refreshTraining(true)}el('studio-operation').textContent=trainingSession&&trainingSession.progress&&trainingSession.progress.label||'Done';if(done)done(result);render()})}
function renderStudio(vm){
  var agent=selectedAgent(),session=trainingSession,approved=!!(agent&&!agent.draft&&agent.approvedTraining),profile=agent&&(agent.approvedTraining||agent.learnedTraining),reusable=!!profile,studio=el('training-studio');
  studio.hidden=!agent||approved;el('reference-learning').hidden=true;el('agent-test-controls').hidden=true;el('agent-memory').hidden=!reusable;
  el('source-picker').hidden=!!agent&&agent.draft&&!reusable;el('general-edit').hidden=!!agent;el('brief-card').hidden=vm.mode==='RUNNING'||vm.paused||!!agent&&agent.draft&&!reusable;
  if(agent&&agent.draft&&!reusable)el('auto').hidden=true;
  if(agent&&agent.draft)el('source-next-step').textContent=reusable?'This agent learned a reference. Load it with a new source to use its saved rules here.':'Open the edited reference in Premiere and choose Learn Timeline. Test Agent will find source media automatically.';
  el('agent-mode-help').textContent=!agent?'No agent selected. Open an original source and use Start editing for general Auto Edit.':approved?'Tested agent selected. Its saved rules load in every project; review compatibility below before Auto Edit.':reusable?'Learned agent selected. Its measured style is saved across projects; Load Agent checks the new source. A representative TEST can improve confidence.':'Draft agent selected. Learn a reference to save reusable knowledge; a TEST can verify the resulting edit.';
  if(reusable){
    var usable=profile.rules.filter(function(x){return x.status==='CONFIRMED'&&x.scope==='general'&&x.support!=='UNAVAILABLE'});
    el('agent-memory-title').textContent='Saved agent: '+agent.name+' · v'+agent.version;
    el('agent-memory-rules').textContent='Saved memory · '+usable.length+' confirmed rules; '+((profile.testRunIds||[]).length)+' verified TESTs\n'+usable.map(function(x){return (x.support==='EXECUTABLE'?'APPLIES':'ADVISORY')+' · '+x.summary+(typeof x.value==='number'?' ('+x.value+' ms)':'')}).join('\n');
    if(profile.knowledge){var k=profile.knowledge;el('agent-memory-rules').textContent+='\nOBSERVED: '+k.observed.shotCount+' reference shots, '+k.observed.cuts+' cuts, '+k.observed.audioTrackCount+' audio tracks.\nDERIVED: '+(k.inferred.styleMemory?'Pacing and layer structure saved as advisory memory.':'Structural memory unavailable.')}
    if(!approved)el('agent-memory-rules').textContent+='\nLEARNED ONLY: No completed TEST has verified this agent yet.';
    var approvedRetests=profile.retestResults||[];if(approvedRetests.length){var measured=approvedRetests[approvedRetests.length-1];el('agent-memory-rules').textContent+='\nObserved pacing retest: '+measured.status+'; target '+measured.targetMs+' ms; current '+(measured.currentObservedMs===null?'unavailable':measured.currentObservedMs+' ms')+'. Editor review still decides acceptance.'}
    el('agent-memory-limits').textContent=profile.capabilityLimitations.length?'Limits: '+profile.capabilityLimitations.slice(0,3).join('; '):'No recorded capability limits.';
    el('agent-load').disabled=agentBusy||trainingBusy||!agentCompatibility||!agentCompatibility.ready||!connected||!engineOnline;
    el('agent-load').textContent=loadedAgentId===agent.id&&loadedAgentVersion===agent.version?'Agent loaded':'Load Agent';
    el('agent-memory-status').textContent=agentLoadProgress&&agentLoadProgress.state==='RUNNING'?agentLoadProgress.label+' ('+Math.floor((Date.now()-agentLoadProgress.startedAt)/1000)+'s)':agentLoadProgress&&agentLoadProgress.state==='FAILED'?'Load failed: '+agentLoadProgress.error:agentCompatibility&&!agentCompatibility.ready?'Agent assets need attention: '+agentCompatibility.reason:loadedAgentId===agent.id&&loadedAgentVersion===agent.version?agentLoadProgress&&agentLoadProgress.state==='COMPLETED'?agentLoadProgress.label+'. Auto Edit is ready.':'Agent loaded for this project. Auto Edit can use its saved rules.':'Choose Load Agent to verify its knowledge, assets and source media in this project.';
    if(approved)return;
  }
  if(!agent)return;
  var report=session&&session.referenceReport,memory=report&&report.styleMemory,incomplete=!!(report&&!report.audioEvidence),stale=!!(session&&Number.isInteger(session.agentVersion)&&session.agentVersion!==agent.version),learning=trainingLearning||trainingBusy&&(!session||incomplete),busy=trainingBusy||trainingLearning,question=session&&session.questions&&session.questions.filter(function(x){return !x.answered})[0],cycle=session&&session.cycles&&session.cycles.length?session.cycles[session.cycles.length-1]:null,changes=cycle&&cycle.changes||[];
  var completedPasses=report?1:0;if(report&&report.mediaEvidence)completedPasses++;if(report&&report.audioEvidence)completedPasses++;
  el('studio-progress').value=completedPasses;
  el('studio-progress-label').textContent=completedPasses+' of 3 evidence passes finished'+(learning?' · working locally':'');
  el('studio-step').textContent=stale?'The saved agent changed; Learn Timeline again.':incomplete?(learning?'Learning reference: '+session.progress.label:'Learning was interrupted. Press Learn Timeline to restart.'):session&&!question&&session.step==='CLARIFY'?'Learning complete. Test Agent is ready.':session?'Step: '+session.step.replace(/_/g,' ')+' - '+session.progress.label:'Open an edited reference timeline, then press Learn Timeline.';
  el('studio-operation').textContent=trainingBusy?trainingOperation+(session&&incomplete?' · '+session.progress.label:''):session&&!incomplete?session.progress.label:'';
  el('studio-completed').textContent=session&&session.progress&&session.progress.completed?session.progress.completed.map(function(x){return '✓ '+x}).join('\n'):'';
  var checks=[];
  checks.push(report?'OBSERVED · Cuts and pace: '+report.observed.cuts+' cuts; '+report.observed.shotCount+' primary clips.':'WAITING · Cuts and pace: read the active reference timeline.');
  checks.push(report&&report.mediaEvidence?report.mediaEvidence.status+' · Footage: '+report.mediaEvidence.sampled+' / '+report.mediaEvidence.total+' source moments sampled. Visual meaning is unverified.':'WAITING · Footage: sample the actual source moments locally.');
  checks.push(report?'OBSERVED · Graphics: '+(memory?memory.picture.graphicLikeClips:0)+' Graphic-labeled clips; '+(report.observed.graphicText?report.observed.graphicText.clipCount:0)+' clips with readable text. Caption role is unverified.':'WAITING · Captions and graphics: inspect Premiere clips and available text.');
  checks.push(report?'UNAVAILABLE · Fonts and exact effects: '+(report.componentEvidence?report.componentEvidence.length:0)+' component identities read; exact visual transfer is not verified.':'WAITING · Fonts and effects: inspect properties exposed by Premiere.');
  checks.push(report&&report.audioEvidence?(report.audioEvidence.status==='INFERRED'?'INFERRED · Audio: '+report.audioEvidence.phraseCount+' speech phrases on track '+(report.audioEvidence.trackIndex+1)+'; narration role unverified.':'UNAVAILABLE · Audio: '+report.audioEvidence.reason):learning&&report?'WORKING · Audio: '+session.progress.label:'WAITING · Audio: inspect local speech and track placement.');
  el('studio-learning-checks').textContent=checks.join('\n');
  var audio=report&&report.audioEvidence,frames=report&&report.mediaEvidence,components=report&&report.componentEvidence||[],values=components.reduce(function(n,c){return n+(c.properties||[]).filter(function(p){return Object.prototype.hasOwnProperty.call(p,'value')}).length},0),componentNames=[],propertySamples=[];
  components.forEach(function(c){if(c.name&&componentNames.indexOf(c.name)<0)componentNames.push(c.name);(c.properties||[]).forEach(function(p){if(propertySamples.length>=6||!p.name||typeof p.value!=='number'&&!((typeof p.value)==='boolean'))return;var label=c.name+' / '+p.name+' = '+String(p.value);if(propertySamples.indexOf(label)<0)propertySamples.push(label)})});
  var examples=audio&&audio.examples||[];
  el('studio-evidence-details').textContent=report?'OBSERVED - Timeline: '+report.observed.shotCount+' primary clips, '+report.observed.cuts+' cuts, '+report.observed.sequence.audioTrackCount+' audio tracks.\nDERIVED - Typical visual shots: '+(memory?memory.pacing.lowerQuartileMs+'-'+memory.pacing.upperQuartileMs+' ms':'unavailable')+'. Graphic-labeled clips: '+(memory?memory.picture.graphicLikeClips:'unavailable')+'.\nOBSERVED - Source frames: '+(frames?frames.sampled+' of '+frames.total:'not sampled')+' locally sampled; image meaning is unverified.\nOBSERVED - Premiere components: '+components.length+' identities and '+values+' simple property values read. Examples: '+(componentNames.slice(0,6).join(', ')||'none')+'.\nOBSERVED - Property samples: '+(propertySamples.join('; ')||'none exposed')+'. These are evidence, not transferable presets.\nUNAVAILABLE - Readable caption text: '+(report.observed.graphicText&&report.observed.graphicText.clipCount||0)+' clips. Exact font and caption styling remain unverified.\n'+(audio&&audio.status==='INFERRED'?'INFERRED - Local speech on audio track '+(Number.isInteger(audio.trackIndex)?audio.trackIndex+1:'unverified')+'; wording and narration role require review.\n'+examples.slice(0,5).map(function(x){return x.start.toFixed(1)+'-'+x.end.toFixed(1)+' s: '+x.text}).join('\n'):audio?'UNAVAILABLE - Local speech: '+audio.reason:'WAITING - Local speech analysis.'):'';
  var answeredNow=session&&session.questions?session.questions.filter(function(x){return !!x.answered}).length:0;
  el('studio-learn-result').textContent=report&&audio?'Reference learned: '+report.observed.shotCount+' primary clips, '+report.observed.cuts+' cuts, '+(frames?frames.sampled:'0')+' source moments, '+(audio.phraseCount||0)+' local speech phrases. '+answeredNow+'/'+session.questions.length+' choices answered. Open What Najm actually found for the evidence.':'';
  el('studio-findings').textContent=report&&memory?'DERIVED · Typical shot range '+memory.pacing.lowerQuartileMs+'–'+memory.pacing.upperQuartileMs+' ms; overlays '+memory.picture.overlayMediaClips+'; reusable pace proposal '+(report.proposed?report.proposed.targetShotDurationMs+' ms':'unavailable')+'.':report?'Timeline measured; a reliable shot target is unavailable.':'No reference evidence saved yet.';
  if(cycle&&trainingTestResult){var t=trainingTestResult,overlap=t.sourceOverlap||{},beats=(t.storyBeats||[]).slice(0,5).map(function(x){return x.summary}).join(' > ');el('studio-findings').textContent+='\nTEST STORY: '+String(t.storySummary||'').slice(0,250)+'\nHook: '+String(t.hook||'')+'\nProgression: '+beats+'\nRules supplied: '+(t.suppliedRules||[]).map(function(x){return x.kind+' '+x.value}).join(', ')+'\nFootage: '+(overlap.novelSourcePaths||0)+' novel source files; '+(overlap.sharedSourcePaths||0)+' also in reference; '+(overlap.sharedSourceMoments||0)+' sampled source moments reused.'+(overlap.limitation?' '+overlap.limitation:'')}
  if(cycle&&cycle.ruleOutcomes&&cycle.ruleOutcomes.length)el('studio-findings').textContent+='\nTEST · '+cycle.ruleOutcomes.map(function(x){return x.ruleId+': target '+x.targetMs+' ms; observed '+(x.observedMs===null?'unavailable':x.observedMs+' ms')+' ('+x.status+')'}).join('; ');
  if(cycle&&cycle.correctionRetest){var retest=cycle.correctionRetest;el('studio-findings').textContent+='\nRETEST: Confirmed pacing correction: '+retest.status+'; target '+retest.targetMs+' ms; prior TEST '+(retest.priorObservedMs===null?'unavailable':retest.priorObservedMs+' ms')+'; current TEST '+(retest.currentObservedMs===null?'unavailable':retest.currentObservedMs+' ms')+'. This measures pace only; review the edit in Premiere.'}
  var answered=session&&session.questions?session.questions.filter(function(x){return !!x.answered}).length:0,cycles=session&&session.cycles?session.cycles.length:0,corrected=session&&session.cycles&&session.cycles.some(function(x){return x.confirmed})||false;
  el('studio-roadmap').textContent='Training: '+(report&&report.audioEvidence?'Reference learned':'Learning reference')+' > '+(cycles?cycles+' TEST'+(cycles===1?'':'s')+' reviewed':'Test Agent')+' > '+(corrected?'Correction learned: retest or save':'Save Agent or Modify Editing Style');
  el('studio-learn').disabled=busy||!connected||!engineOnline||!vm.buildMatches||!vm.health.buildReady||!!job&&job.running;
  el('studio-cancel-learn').hidden=!learning;el('studio-cancel-learn').disabled=trainingCancelling||!connected||!engineOnline;
  el('studio-learn').textContent=report&&report.audioEvidence&&!stale?'Relearn Timeline':'Learn Timeline';
  el('studio-clarify').hidden=!question||incomplete||stale;el('studio-question').textContent=question?question.question:'';el('studio-answer-submit').disabled=busy||incomplete||stale;
  el('studio-test').hidden=!session||incomplete||stale||session.step==='REVIEW_TEST';var confirmed=session&&session.rules.some(function(x){return x.status==='CONFIRMED'&&x.support==='EXECUTABLE'}),start=Number(el('studio-test-start').value),end=Number(el('studio-test-end').value),valid=el('studio-test-start').value!==''&&el('studio-test-end').value!==''&&Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end-start>=3&&end-start<=30;
  el('studio-suggest').disabled=busy||incomplete||!vm.eligible||!!job&&job.running;
  el('studio-prepare').disabled=busy||incomplete||stale||!trainingSessionProjectMatches||!confirmed||!connected||!engineOnline||!vm.buildMatches||!vm.health||!vm.health.buildReady||!!job&&job.running;
  el('studio-open-source').disabled=busy||!connected||!engineOnline||vm.mode==='RUNNING'||!el('studio-sources').value||!!source&&el('studio-sources').value===source.id;
  el('studio-open-source').textContent=el('studio-open-source').disabled&&vm.eligible?'Original source open for TEST':'Open selected original for TEST';
  el('studio-pending').textContent=stale?'This training session belongs to an earlier agent version. The saved agent memory remains available.':!trainingSessionProjectMatches?'This reference was learned in another project. Load Agent here for Auto Edit; return to the training project to run its TEST.':job&&job.running&&job.operation==='TEST'?'Creating the independent TEST timeline.':cycle&&session.step==='REVIEW_TEST'?'TEST is ready in Premiere. Review it, then save or modify the agent.':incomplete?'Learning is still in progress.':'Najm will select complete speech and discover source media automatically.';
  el('studio-apply').hidden=true;el('studio-apply').disabled=true;
  el('studio-modify').hidden=!cycle||session.step!=='REVIEW_TEST'||modifyingStyle;el('studio-update').hidden=!cycle||!modifyingStyle;el('studio-update-button').disabled=trainingBusy||!!job&&job.running||!cycle||!!cycle.confirmed;
  el('studio-differences').textContent=cycle&&cycle.changes?'OBSERVED · '+changes.length+' supported differences:\n'+changes.slice(0,20).map(function(x){return x.trackType+' '+x.track+' · '+x.kind+' · '+x.clip}).join('\n')+(changes.length>20?'\n… '+(changes.length-20)+' more':''):'No correction comparison saved yet.';
  el('studio-confirm-correction').hidden=!changes.length||!!cycle.confirmed;el('studio-confirm-correction').disabled=trainingBusy||!el('studio-correction-reason').value.trim();
  var canApprove=session&&cycles>=1&&session.step==='REVIEW_TEST';el('studio-approve').hidden=!canApprove;el('studio-approve').disabled=trainingBusy;
}
function renderAgentList(){
  if(!document.createElement)return;
  var select=el('agent-select');select.textContent='';var none=document.createElement('option');none.value='';none.textContent='No agent';select.appendChild(none);
  agents.forEach(function(agent){var option=document.createElement('option');option.value=agent.id;option.textContent=agent.name+' · v'+agent.version+(agent.approvedTraining?' · Tested':agent.learnedTraining?' · Learned':' · Draft');select.appendChild(option)});
  if(selectedAgentId&&!selectedAgent())selectedAgentId='';select.value=selectedAgentId;
}
function refreshAgents(){if(!engineOnline||agentLoading)return;agentLoading=true;request('GET','/v2/agents',null,function(error,result){agentLoading=false;if(error||!Array.isArray(result)){el('agent-error').textContent=error||'Could not load agents';return}agents=result;agentsLoaded=true;renderAgentList();if(selectedAgentId&&selectedAgent())editAgent(selectedAgent());refreshTraining(true);render()})}
function request(method,path,body,done){
  var x=new XMLHttpRequest(),finished=false,label=method==='GET'?requestLabel(path):null,started=Date.now();
  if(label&&!viewModel().eligible)setupProgress(label,true);
  function complete(error,value){if(finished)return;finished=true;if(label&&error)setupProgress(label+': '+String(error),false);else if(label&&!viewModel().eligible)setupProgress(label+' responded in '+Math.max(0,Date.now()-started)+' ms',false);done(error,value)}
  x.open(method,base+path,true);try{x.setRequestHeader('Authorization','Bearer '+sessionToken())}catch(_){done('Local session bootstrap unavailable; reinstall V2');return;}x.timeout=path==='/v2/training/learn'?1200000:path==='/v2/training/prepare'||path==='/v2/agents/load'?600000:path==='/v2/health'||path==='/v2/status'||path.indexOf('/v2/reference-analysis')===0||path.indexOf('/v2/training/')===0?45000:10000;
  x.onreadystatechange=function(){if(x.readyState!==4)return;var value={};try{value=JSON.parse(x.responseText)}catch(_){}complete(x.status>=200&&x.status<300?null:value.error||'Engine unavailable',value)};
  x.onerror=function(){complete('Engine unavailable')};x.ontimeout=function(){complete('Engine timeout')};
  if(body)x.setRequestHeader('Content-Type','application/json');
  if(window.NAJM_V2_CONFIG&&window.NAJM_V2_CONFIG.buildId)x.setRequestHeader('X-Najm-Build',window.NAJM_V2_CONFIG.buildId);
  x.send(body?JSON.stringify(body):null);
}
function engineStart(){
  if(job&&job.running)return;
  var delay=engineAttempts===0?0:Math.min(30000,5000*Math.pow(2,Math.min(engineAttempts-1,3)));
  if(Date.now()-engineStartAt<delay)return;
  engineStartAt=Date.now();engineAttempts++;
  try{
    var config=window.NAJM_V2_CONFIG||{},root=config.root;
    if(!root||!config.nodePath)throw Error('Najm runtime path is not installed');
    // CEP can terminate a PowerShell child and its Start-Process child together.
    // Launch the engine directly; the health handshake verifies its exact build.
    var process=require('child_process').spawn(config.nodePath,[root+'\\dist\\services\\v2\\server.js'],{cwd:root,detached:true,windowsHide:true,stdio:'ignore'});
    process.on('error',function(error){actionFailure='Engine startup: '+error;render()});process.unref();
  }catch(error){actionFailure='Engine startup: '+error;render()}
}
function schedule(){if(reconnectTimer)return;reconnectTimer=setTimeout(function(){reconnectTimer=null;connect()},1500)}
var buildRefreshBusy=false;
function refreshInstalledPanelBuild(){
  if(buildRefreshBusy)return;buildRefreshBusy=true;
  try{
    var x=new XMLHttpRequest();x.open('GET','config.js?v='+Date.now(),true);
    x.onreadystatechange=function(){if(x.readyState!==4)return;buildRefreshBusy=false;var match=String(x.responseText||'').match(/"buildId"\s*:\s*"([a-f0-9]{64})"/i),current=window.NAJM_V2_CONFIG&&window.NAJM_V2_CONFIG.buildId;if(match&&current&&match[1]!==current&&window.location&&window.location.replace)window.location.replace('index.html?buildRefresh='+Date.now())};
    x.send();
  }catch(_){buildRefreshBusy=false}
}
function connect(){
  if(socket&&(socket.readyState===0||socket.readyState===1))return;
  var current;
  setupProgress('Opening Premiere Direct socket',true);
  try{current=new WebSocket('ws://127.0.0.1:47842/premiere-direct?buildId='+encodeURIComponent(window.NAJM_V2_CONFIG&&window.NAJM_V2_CONFIG.buildId||''),['najm-v2',sessionToken()]);socket=current}catch(_){schedule();return}
  current.onopen=function(){if(socket!==current)return;setupProgress('Socket open; waiting for Premiere Direct handshake',true);refresh()};
  current.onclose=function(event){if(socket!==current)return;socket=null;connected=false;ready=false;healthAt=0;statusAt=0;healthBusy=false;statusBusy=false;connectionEpoch++;if(health)health.directConnected=false;queue=[];busy=false;if(event&&event.code===1008){actionFailure='Premiere Direct rejected the panel build. Reload the Najm V2 panel.';refreshInstalledPanelBuild()}setupProgress(actionFailure||'Premiere Direct disconnected; reconnecting',true);render();schedule()};
  current.onerror=function(){if(socket!==current)return;connected=false;try{current.close()}catch(_){}schedule()};
  current.onmessage=function(event){if(socket!==current)return;var message;try{message=JSON.parse(event.data)}catch(_){return}if(message.type==='hello'&&message.version===2){connected=true;connectionEpoch++;healthBusy=false;statusBusy=false;healthRequest++;statusRequest++;healthAt=0;statusAt=0;actionFailure='';setupProgress('Premiere Direct handshake complete; refreshing setup',true);refresh();return}if(message.type==='request'&&connected){queue.push(message);drain()}};
}
function drain(){
  if(busy||!queue.length||!socket||socket.readyState!==1)return;
  busy=true;var message=queue.shift(),current=socket;
  var code='$.evalFile('+JSON.stringify(String(window.NAJM_V2_CONFIG&&window.NAJM_V2_CONFIG.panelRoot||'').replace(/\\/g,'/')+'/host.jsx')+');NajmV2.dispatch('+JSON.stringify(JSON.stringify({operation:message.operation,args:message.args}))+')';
  window.__adobe_cep__.evalScript(code,function(raw){
    var result;try{result=JSON.parse(raw)}catch(_){result={ok:false,error:'Invalid Premiere host response: '+String(raw).slice(0,180)}}
    if(socket===current&&current.readyState===1)current.send(JSON.stringify({type:'result',id:message.id,ok:!!result.ok,result:result.result,error:result.error}));
    busy=false;setTimeout(drain,0);
  });
}
function editorialStage(){
  if(!job)return 0;if(job.phase==='DONE')return 8;if(job.operation==='CAPTIONS_ONLY'){var captionStages={AUDIO:0,STORY:1,BUILD:5,GRAPHICS:6,VALIDATE:7};if(captionStages[job.phase]!==undefined)return captionStages[job.phase]}
  var percent=Number(job.percent)||0,checkpoint=percent>=95?7:percent>=87?6:percent>=75?5:percent>=66?4:percent>=50?3:percent>=32?2:percent>=20?1:0;
  if(job.phase==='AUDIO')return Math.max(checkpoint,percent>=32?2:0);
  if(job.phase==='STORY')return Math.max(checkpoint,1);
  if(job.phase==='CONTACT_SHEETS')return Math.max(checkpoint,3);
  if(job.phase==='EDIT_PLAN')return Math.max(checkpoint,4);
  if(job.phase==='BUILD')return Math.max(checkpoint,5);
  if(job.phase==='GRAPHICS')return Math.max(checkpoint,6);
  if(job.phase==='VALIDATE')return Math.max(checkpoint,7);
  return checkpoint;
}
function captionsMode(){return !!(job&&job.operation==='CAPTIONS_ONLY'||el('edit-mode').value==='CAPTIONS_ONLY')}
function viewModel(){
  var h=health||{},buildMatches=!!h.buildId&&!!window.NAJM_V2_CONFIG&&window.NAJM_V2_CONFIG.buildId===h.buildId;
  var fresh=Date.now()-healthAt<12000&&Date.now()-statusAt<12000;
  var eligible=!!(fresh&&engineOnline&&connected&&(captionsMode()?h.captionsReady:ready)&&source&&(captionsMode()?h.captionsReady:h.ready)&&h.directConnected&&h.sourceReady&&h.stateReady&&h.buildReady&&buildMatches);
  var booting=(!engineOnline||!connected)&&Date.now()-bootAt<30000;
  var active=!!job&&job.status!=='CANCELLED'&&job.phase!=='DISCARDED'&&job.phase!=='CANCELLED';
  var mode;
  if(!active)mode=eligible?'READY':'SETUP';
  else if(job.status==='COMPLETED'||job.phase==='DONE')mode='COMPLETED';
  else if(job.status==='FAILED'||job.phase==='ERROR')mode='FAILED';
  else if(job.status==='INTERRUPTED'||!engineOnline&&job.running)mode='INTERRUPTED';
  else if(job.status==='RUNNING'||job.running)mode='RUNNING';
  else mode=job.resumable?'INTERRUPTED':'READY';
  return {health:h,eligible:eligible,booting:booting,mode:mode,hasRun:active,paused:mode==='FAILED'||mode==='INTERRUPTED',stage:editorialStage(),percent:active?Math.max(0,Math.min(100,Number(job.percent)||0)):0,buildMatches:buildMatches,fresh:fresh};
}
function referenceViewReady(vm){var h=vm.health;return vm.mode==='SETUP'&&!!referenceSequence&&connected&&engineOnline&&vm.fresh&&h.directConnected&&h.buildReady&&vm.buildMatches}
function state(){return viewModel().mode}
function clock(ms){var seconds=Math.floor(Math.max(0,ms)/1000);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
function updateElapsed(){
  var ms=job?Number(job.activeProcessingMs):0;
  if(!Number.isFinite(ms))ms=job?Math.max(0,Number(job.updatedAt)-Number(job.startedAt)-Number(job.pausedMs||0)):0;
  if(job&&state()==='RUNNING')ms+=Math.max(0,Date.now()-Number(job.updatedAt||Date.now()));
  el('elapsed').textContent=clock(ms);
  var age=job&&Number(job.lastActivityAt)>0?Math.max(0,Date.now()-Number(job.lastActivityAt)):0;
  el('activity-age').hidden=state()!=='RUNNING'||age<30000;
  el('activity-age').textContent=age>=30000?'Last progress update: '+clock(age)+' ago':'';
}
function duration(ms){return typeof ms==='number'?clock(ms):'unavailable'}
function callUsage(name,call){
  if(!call)return name+': Not started';
  var telemetry=call.telemetry||{},lines=[name,'Model: '+(call.model||'unknown'),'Reasoning: '+(call.reasoningEffort||'unknown'),'Status: '+(call.cached?'cached result (0 new model calls)':call.executed||typeof telemetry.inputTokens==='number'?'Completed':'Pending')];
  if(typeof telemetry.inputTokens==='number')lines.push('Input: '+telemetry.inputTokens);
  if(typeof telemetry.cachedInputTokens==='number')lines.push('Cached input: '+telemetry.cachedInputTokens);
  if(typeof telemetry.outputTokens==='number')lines.push('Output: '+telemetry.outputTokens);
  if(typeof telemetry.totalTokens==='number'||typeof telemetry.totalTokensDerived==='number')lines.push('Total: '+(telemetry.totalTokens||telemetry.totalTokensDerived));
  lines.push('Duration: '+duration(call.durationMs));if(call.imageCount)lines.push('Images/sheets: '+call.imageCount);
  lines.push('Allowance: '+(typeof telemetry.creditsOrAllowance==='number'?telemetry.creditsOrAllowance:'unavailable from Codex CLI'));
  return lines.join('\n');
}
function renderUsage(vm){
  if(!vm.hasRun||!usage){el('usage-summary').textContent=engineOnline?'No current run':'Waiting for local engine; saved runs will reload automatically.';return}
  var stages=usage.stages||{},calls=usage.calls||{},sourceStage=stages.narrationSource,clean=stages.cleanAudioVerification,audio=stages.audioConstruction,sheets=stages.contactSheets,premiere=stages.premiereBuild,graphics=stages.graphics;
  var modelCalls=[calls.story,calls.visual].filter(function(x){return x&&(x.executed||x.telemetry&&typeof x.telemetry.inputTokens==='number')});
  var totalInput=modelCalls.reduce(function(n,x){return n+Number(x.telemetry&&x.telemetry.inputTokens||0)},0),totalOutput=modelCalls.reduce(function(n,x){return n+Number(x.telemetry&&x.telemetry.outputTokens||0)},0),aiMs=modelCalls.reduce(function(n,x){return n+Number(x.durationMs||0)},0);
  var whisper=sourceStage||clean?Number(sourceStage&&sourceStage.whisperDurationMs||0)+Number(clean&&clean.whisperDurationMs||0):null;
  var ffmpeg=sourceStage||audio||sheets?Math.max(0,Number(sourceStage&&sourceStage.durationMs||0)-Number(sourceStage&&sourceStage.whisperDurationMs||0))+Number(audio&&audio.durationMs||0)+Number(sheets&&sheets.durationMs||0):null;
  var lines=['AI Usage','GPT calls: '+(Number(job.gptCalls)||0)+' / 2','',callUsage('Story cleanup',calls.story),'',callUsage('Visual editor',calls.visual),'','Run total','Tokens: '+(modelCalls.every(function(x){return x.telemetry&&x.telemetry.exactUsageAvailable})?totalInput+' input / '+totalOutput+' output':'exact tokens unavailable'),'AI time: '+duration(aiMs),'','Local Processing','Whisper: '+duration(whisper),'FFmpeg/contact sheets: '+duration(ffmpeg),'Premiere build: '+duration(premiere&&premiere.durationMs),'Graphics: '+duration(graphics&&graphics.durationMs),'Total AUTO EDIT: '+duration(typeof usage.totalAutoEditDurationMs==='number'?usage.totalAutoEditDurationMs:job.activeProcessingMs)];
  if(job.operation==='CAPTIONS_ONLY')lines=['AI Usage','Sol transcript review: '+(Number(job.gptCalls)||0)+' / 1','',callUsage('Arabic transcript and title',calls.story),'','GPT audio transcription: '+(stages.gptTranscription&&stages.gptTranscription.model||'configured provider'),'Audio transcription time: '+duration(stages.gptTranscription&&stages.gptTranscription.durationMs),'Audio API token usage: unavailable','Whisper: not used','Total run: '+duration(typeof usage.totalAutoEditDurationMs==='number'?usage.totalAutoEditDurationMs:job.activeProcessingMs)];el('usage-summary').textContent=lines.join('\n');
}
function indicator(id,label,kind){el('ready-'+id).textContent=label;el('ready-'+id+'-dot').className='dot '+kind}
function renderReadiness(vm){
  var h=vm.health,preparing=vm.booting,checked=engineOnline&&vm.fresh,referenceReady=referenceViewReady(vm),speechReady=captionsMode()?h.gptTranscriptionReady:h.whisperReady;
  indicator('engine',checked?'Ready':preparing?'Starting':'Unavailable',checked?'ok':preparing?'checking':'bad');
  indicator('premiere',checked&&connected&&h.directConnected?'Connected':preparing?'Connecting':'Disconnected',checked&&connected&&h.directConnected?'ok':preparing?'checking':'bad');
  indicator('ai',checked?(h.gptReady?'Ready':'Unavailable'):'Checking',checked?(h.gptReady?'ok':'bad'):'checking');
  indicator('assets',checked?(h.assetsReady?'Ready':'Missing'):'Checking',checked?(h.assetsReady?'ok':'bad'):'checking');
  indicator('source',checked?(h.sourceReady?'Ready':referenceSequence?'Reference open':'Needs attention'):'Checking',checked?(h.sourceReady?'ok':'bad'):'checking');
  indicator('media',checked?(speechReady&&h.ffmpegReady&&h.sourceReady?'Ready':referenceSequence?'Original needed':'Needs attention'):'Checking',checked?(speechReady&&h.ffmpegReady&&h.sourceReady?'ok':'bad'):'checking');
  indicator('build',checked?(h.buildReady&&vm.buildMatches?'Compatible':'Mismatch'):'Checking',checked?(h.buildReady&&vm.buildMatches?'ok':'bad'):'checking');
  var readiness=el('readiness-state');readiness.textContent=vm.eligible?'All Ready':referenceReady?'Reference ready':preparing?'Preparing':'Setup needed';readiness.className='pill'+(vm.eligible||referenceReady?'':preparing?' waiting':' warning');
  var prompt='';
  if(!vm.eligible){
    if(!engineOnline)prompt=job&&job.running?'An edit was active when the engine became unavailable. Check Diagnostics before restarting it.':preparing?'Starting the local engine.':'Local engine unavailable. Select Connect / Retry.';
    else if(!vm.fresh)prompt='Checking current engine and Premiere state.';
    else if(!vm.buildMatches||!h.buildReady)prompt='Build mismatch. '+((h.buildIssues||[])[0]||'Panel and engine build IDs differ')+'. Install a matching build after reviewing the active job.';
    else if(!connected||!h.directConnected)prompt=preparing?'Connecting to Premiere…':'Premiere Direct disconnected. Open the Najm V2 panel in Premiere, then select Connect / Retry.';
    else if(!h.sourceReady)prompt=referenceSequence?'Read-only analysis is available for '+referenceSequence.name+'. Select a saved agent and use Analyze Current Timeline below. Open an original source sequence only for TEST or editing.':h.sourceError||'Open and save a source sequence in Premiere.';
    else if(!h.stateReady)prompt=h.stateError||'The active source belongs to another run.';
    else if(!h.gptReady)prompt='Codex ChatGPT login is unavailable. Sign in through Codex, then recheck.';
    else if(captionsMode()&&!h.gptTranscriptionReady)prompt='Set OPENAI_API_KEY or NAJM_OPENAI_API_KEY in the local engine environment for GPT transcription, then restart the engine. No Whisper is used in this mode.';else if(!captionsMode()&&!h.whisperReady)prompt='Local Whisper Medium model or Python runtime is unavailable.';
    else if(!h.ffmpegReady)prompt='FFmpeg is unavailable on this computer.';
    else if(!h.assetsReady)prompt='Caption or title templates are missing.';
    else prompt='Checking current source and setup.';
  }
  el('readiness-action').textContent=prompt;
  el('setup-progress').hidden=vm.eligible||referenceReady;
  el('engine').textContent=checked?'Ready':preparing?'Starting':'Unavailable';
  el('premiere').textContent=checked&&connected&&h.directConnected?'Connected':'Disconnected';
  el('whisper').textContent=checked?(h.whisperReady?'Medium':'Unavailable'):'Checking';
  el('gpt').textContent=checked?(h.gptReady?'Ready':'Unavailable'):'Checking';
  el('ffmpeg').textContent=checked?(h.ffmpegReady?'Ready':'Unavailable'):'Checking';
  el('build-id').textContent=h.buildId||'Unavailable';el('run-id').textContent=vm.hasRun?job.id||'Unavailable':'None';
}
function renderSource(vm){
  var h=vm.health,project=el('project-state');
  project.textContent=vm.fresh&&connected&&source&&h.sourceReady?'Ready':referenceSequence?'Reference open':source?'Needs attention':engineOnline?'Select source':'Checking';
  project.className='pill'+(vm.fresh&&connected&&source&&h.sourceReady?'':engineOnline?' warning':' waiting');
  el('source').textContent=source?source.name:referenceSequence?referenceSequence.name:engineOnline?'Open a saved source sequence':'Checking…';
  if(projectSnapshot&&source&&projectSnapshot.id===source.id){
    var video=projectSnapshot.videoTracks||[],audio=projectSnapshot.audioTracks||[],paths={};
    video.concat(audio).forEach(function(track){(track.clips||[]).forEach(function(clip){if(clip.mediaPath)paths[clip.mediaPath.toLowerCase()]=true})});
    el('project-meta').textContent=(projectSnapshot.width&&projectSnapshot.height?projectSnapshot.width+' × '+projectSnapshot.height+' · ':'')+(Number(projectSnapshot.sequenceFps)||0).toFixed(3)+' fps · '+clock(Number(projectSnapshot.duration)*1000)+' · '+video.length+' video / '+audio.length+' audio tracks · '+Object.keys(paths).length+' source items';
  }else el('project-meta').textContent=source?'Reading sequence details…':referenceSequence?'Open as a read-only reference. Use Analyze Current Timeline under Editing agent.':'Open a saved source sequence in Premiere.';
  el('activate').disabled=acting||!connected||vm.mode==='RUNNING'||!el('sources').value||!!source&&el('sources').value===source.id;
  var agent=selectedAgent(),confirmed=trainingSession&&trainingSession.rules&&trainingSession.rules.some(function(rule){return rule.status==='CONFIRMED'&&rule.support==='EXECUTABLE'});
  el('source-next-step').textContent=referenceViewReady(vm)?!agent?'This is a read-only reference. To edit, open an original source above and select No agent for general Auto Edit.':agent.draft?confirmed?'Reference learning is saved. Open an original source above, then enter a TEST range in Agent Training Studio.':'This is a read-only reference. Answer the style question and press Save answer below. Then open an original source above for TEST.':'This is a read-only reference. Open an original source above to use the approved agent for Auto Edit.':vm.eligible&&vm.mode==='READY'?!agent?'Original source ready. General Auto Edit is available below.':agent.draft?confirmed?'Original source ready. Enter a 3-30 second range in Agent Training Studio to review a TEST.':'Original source ready. Confirm a reusable style choice below to unlock TEST.':'Original source ready. Approved agent Auto Edit is available below.':'';
  el('general-auto').disabled=acting||vm.mode!=='READY'||!vm.eligible||!vm.health.ready;
  el('general-auto-status').textContent=referenceViewReady(vm)?'Open an original source above to enable general Auto Edit. The reference timeline stays read-only.':vm.mode==='READY'&&vm.eligible?'Ready for general Auto Edit on '+source.name+'. This does not use the selected agent.':vm.mode==='RUNNING'?'An edit is running.':'Complete the source and connection checks to start general Auto Edit.';
}
function renderRun(vm){
  var mode=vm.mode,hasRun=vm.hasRun,paused=vm.paused,noSpeech=emptyNarrationTest(job);
  el('run-view').hidden=!hasRun;el('run-stages').hidden=!paused;el('result-view').hidden=mode!=='COMPLETED';el('run-metrics').hidden=!hasRun;
  el('progress-label').textContent=mode==='RUNNING'?'Working':vm.percent+'%';el('progress-ring-label').textContent=mode==='RUNNING'?'...':vm.percent+'%';if(mode==='RUNNING'){if(el('progress').removeAttribute)el('progress').removeAttribute('value')}else el('progress').value=vm.percent;
  var ring=el('progress-ring');if(ring.style&&ring.style.setProperty)ring.style.setProperty('--progress',vm.percent+'%');
  var captionRun=!!job&&job.operation==='CAPTIONS_ONLY';el('stage-row').hidden=!hasRun;el('stage').textContent=hasRun?captionRun&&vm.stage===0?'Transcribing Audio':captionRun&&vm.stage===1?'Reviewing Arabic Transcript':captionRun&&vm.stage===5?'Preserving Timeline':stageNames[vm.stage]:'';
  el('stage-detail').textContent=mode==='RUNNING'&&job.phase==='CONTACT_SHEETS'&&job.mediaProgress?'Understanding '+job.mediaProgress.completedCount+' / '+job.mediaProgress.totalCount+' source clips':mode==='RUNNING'&&job.activity?job.activity:hasRun?stageDetails[vm.stage]:'';
  var list=el('stage-map');if(list.children)for(var i=0;i<list.children.length;i++){list.children[i].hidden=captionRun&&i>=2&&i<=4;list.children[i].className=i<vm.stage?'complete':i===vm.stage?'active':'waiting';list.children[i].textContent=captionRun&&i===0?'Transcribing Audio':captionRun&&i===1?'Reviewing Arabic Transcript':captionRun&&i===5?'Preserving Timeline':stageNames[i]}
  el('progress-heading').textContent=captionRun?'Captions and title progress':job&&job.operation==='TEST'?'Agent test progress':'Editing progress';
  el('run-training-context').hidden=!(job&&job.operation==='TEST');el('run-training-context').textContent=job&&job.operation==='TEST'?'Isolated TEST · '+(job.agent&&job.agent.name||'saved agent')+' v'+(job.agent&&job.agent.version||'?')+(job.testSection?' · '+job.testSection.start+'–'+job.testSection.end+' s':'')+'. The original source stays unchanged.':'';
  el('result-heading').textContent=captionRun?'Captions and title ready':job&&job.operation==='TEST'?'Agent test ready':'Edit ready';
  el('run-heading').textContent=noSpeech?'Choose another test section':mode==='INTERRUPTED'?'Run interrupted':job&&job.operation==='TEST'?'Agent test paused':'Editing paused';
  el('error').textContent=noSpeech?'The '+job.testSection.start+'–'+job.testSection.end+' s TEST selected no narration for the final video. Choose a section with words intended for viewers.':mode==='FAILED'?"We couldn't finish "+stageNames[vm.stage]+'.':mode==='INTERRUPTED'?'Your saved edit can continue when the connection is ready.':'';
  el('completed').textContent=stageInfo&&stageInfo.completed&&stageInfo.completed.length?stageInfo.completed.map(function(item){return '✓ '+item}).join('\n'):'None yet';
  el('next').textContent=noSpeech?'A different narration range':stageInfo&&stageInfo.next||'Unknown';el('resume-preview').textContent=noSpeech?'Discard this failed run, then enter a new 3–30 s TEST range. Resume would repeat the same saved result.':job&&job.agent&&job.operation!=='TEST'&&!job.agent.approvedTraining&&!job.agent.learnedTraining?'This agent run cannot resume until Learn Timeline has saved a reusable profile.':stageInfo&&stageInfo.resumePreview||'';
  el('calls').textContent=(hasRun?Number(job.gptCalls)||0:0)+(captionRun?' / 1 Sol review':' / 2');
  var details=[];if(job&&job.detail)details.push(job.detail);if(job&&job.error)details.push(job.error);if(vm.health&&vm.health.sourceError)details.push(vm.health.sourceError);if(vm.health&&vm.health.stateError&&vm.health.stateError!==vm.health.sourceError)details.push(vm.health.stateError);if(vm.health&&vm.health.buildIssues)details=details.concat(vm.health.buildIssues);
  if(actionFailure)details.push(actionFailure);el('detail').textContent=details.join('\n');
  renderUsage(vm);updateElapsed();
}
function renderActions(vm){
  var mode=vm.mode,paused=vm.paused,agent=selectedAgent(),referenceOnly=referenceViewReady(vm);
  var captionMode=captionsMode();el('edit-mode').disabled=acting||mode==='RUNNING'||paused;el('caption-options').hidden=!captionMode;el('caption-audio-track').disabled=acting||mode==='RUNNING'||paused;el('edit-mode-help').textContent=captionMode?'Your edit stays intact. Only captions and a title are added to a preserved copy.':'Auto Edit keeps the original sound of selected footage alongside narration.';el('caption-provider-status').textContent=vm.health.gptTranscriptionReady?'GPT audio transcription is configured. Sol reviews wording and writes the title.':'An OpenAI API key is needed: set OPENAI_API_KEY or NAJM_OPENAI_API_KEY for the local engine, then restart it.';
  el('auto').hidden=mode!=='READY'&&mode!=='COMPLETED'&&!referenceOnly;el('auto').textContent=mode==='COMPLETED'?'New edit':referenceOnly?'Auto Edit - open an original source':captionMode?'Add captions + title'+(agent?' with '+agent.name:''):agent&&(agent.approvedTraining||agent.learnedTraining)?'Start Auto Edit with '+agent.name:agent?'Agent Auto Edit - learn a reference first':'Start Auto Edit';
  el('auto').disabled=acting||!vm.eligible||mode!=='READY'&&mode!=='COMPLETED'||mode==='READY'&&!!selectedAgentId&&(!selectedAgent()||!(selectedAgent().approvedTraining||selectedAgent().learnedTraining)||!agentCompatibility||!agentCompatibility.ready||!captionMode&&(loadedAgentId!==selectedAgentId||loadedAgentVersion!==selectedAgent().version));
  el('edit-action-help').textContent=referenceOnly?'Auto Edit is unavailable while '+referenceSequence.name+' is open as a reference. Choose an original above and press Open selected original.':mode==='READY'&&agent&&agent.draft&&!agent.learnedTraining?'Learn a reference to save this agent for other projects. Select No agent for general Auto Edit.':'';
  var startValue=el('test-start').value,endValue=el('test-end').value,start=Number(startValue),end=Number(endValue),sourceDuration=projectSnapshot&&source&&projectSnapshot.id===source.id?Number(projectSnapshot.duration):NaN;
  var validSection=startValue!==''&&endValue!==''&&Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end-start>=3&&end-start<=30&&(!Number.isFinite(sourceDuration)||end<=sourceDuration+.02);
  el('agent-test-controls').hidden=!agent;
  el('agent-test').hidden=true;
  el('agent-test').disabled=true;
  el('test-action-note').textContent=!agent?'':acting?'Wait for the current action to finish.':!vm.eligible?'Complete the setup checks above, then retry.':mode==='RUNNING'?'Wait for the current run to finish or pause it.':mode==='COMPLETED'?'Select New edit before starting another TEST.':mode!=='READY'?'Resume or discard the current run before starting a new TEST.':!agent.instructions?'Save instructions for this agent before testing.':startValue===''||endValue===''?'Enter the start and end seconds for a manual TEST.':!Number.isFinite(start)||!Number.isFinite(end)||start<0?'Enter valid nonnegative seconds.':end-start<3||end-start>30?'Choose a range from 3 to 30 seconds.':Number.isFinite(sourceDuration)&&end>sourceDuration+.02?'The end exceeds this source sequence ('+sourceDuration.toFixed(2)+' s). Choose an earlier end.':!Number.isFinite(sourceDuration)?'Source duration is unavailable in the panel. Premiere will verify this range before starting the TEST.':'';
  el('test-suggest').disabled=acting||!vm.eligible||mode!=='READY'||!agent;
  el('test-start').disabled=acting||mode==='RUNNING';el('test-end').disabled=acting||mode==='RUNNING';
  el('test-status').textContent=job&&job.operation==='TEST'&&job.testSection?'Test '+(job.status||job.phase)+' · agent v'+(job.agent&&job.agent.version||'?')+' · '+job.testSection.start+'–'+job.testSection.end+' s':'';
  var referenceOnlyReady=referenceOnly&&vm.health.gptReady&&vm.health.whisperReady&&vm.health.ffmpegReady&&vm.health.assetsReady;
  el('retry').hidden=vm.eligible||referenceOnlyReady;el('retry').disabled=acting||!!job&&job.running&&!engineOnline;
  el('cancel').hidden=mode!=='RUNNING';el('cancel').disabled=acting||mode!=='RUNNING';
  el('resume').hidden=!paused||!job.resumable||emptyNarrationTest(job);el('resume').disabled=acting||!connected||!engineOnline||!!job&&!!job.agent&&job.operation!=='TEST'&&!job.agent.approvedTraining&&!job.agent.learnedTraining;
  el('discard').hidden=!paused||!job.resumable&&mode!=='FAILED';el('discard').disabled=acting||!connected||!engineOnline;
  el('brief').disabled=mode==='RUNNING'||acting;el('brief-card').hidden=mode==='RUNNING'||paused;el('agent-card').hidden=mode==='RUNNING'||paused;
  el('agent-select').disabled=mode==='RUNNING'||acting||agentBusy||referenceBusy;el('agent-new').disabled=mode==='RUNNING'||agentBusy||referenceBusy;el('agent-save').disabled=mode==='RUNNING'||agentBusy||referenceBusy||!!agent&&!agent.draft;el('agent-save').hidden=!!agent&&!agent.draft;
  ['agent-name','agent-description','agent-instructions'].forEach(function(id){el(id).disabled=!!agent&&!agent.draft});
  el('action-panel').hidden=paused&&(vm.eligible||vm.booting);
  if(mode!=='RUNNING'&&el('brief').value!==briefDraft)el('brief').value=briefDraft;
  el('brief-count').textContent=String(el('brief').value||'').length+' / 8000';
  el('cache-note').hidden=!(cachePlan&&cachePlan.visual==='INVALID'&&mode==='READY');el('cache-note').textContent=cachePlan&&cachePlan.description||'';
  el('action-error').textContent=actionFailure?'Could not complete this action. Open Diagnostics for details.':'';
}
function render(){
  var vm=viewModel(),mode=vm.mode,noSpeech=emptyNarrationTest(job);
  var referenceReady=referenceViewReady(vm);
  if(document.body)document.body.className='mode-'+mode.toLowerCase();
  el('current').textContent=referenceReady?'REFERENCE':mode==='SETUP'&&vm.booting?'PREPARING':mode==='COMPLETED'?'DONE':mode;
  el('intro-title').textContent=noSpeech?'This TEST needs a different narration section.':mode==='COMPLETED'?'Your edit is ready.':mode==='RUNNING'?'Your edit is taking shape.':vm.paused?'Your edit is paused.':referenceReady?'Learn from this timeline.':mode==='SETUP'?(vm.booting?'Preparing Najm…':'Finish setup to start.'):'Turn your footage into a story.';
  el('hero-copy').textContent=noSpeech?'Discard this failed run, then select a range with narration intended for the final video.':mode==='COMPLETED'?'Open the generated sequence in Premiere.':mode==='RUNNING'?'Najm is shaping your story and building the edit.':vm.paused?'Your progress is saved. Resume when ready.':referenceReady?'Select a saved agent and analyze the active timeline below.':mode==='SETUP'?(vm.booting?'Connecting your editing workspace.':'Check the setup items below.'):'Fast. Natural. Professional.';
  renderReadiness(vm);renderSource(vm);renderActions(vm);renderReference();renderStudio(vm);renderRun(vm);
  if(vm.eligible)setupProgress('Ready: engine, Premiere Direct, source, AI, media and build verified',false);
}
function refreshSources(){
  if(!connected||!document.createElement||Date.now()-sourceListAt<10000)return;
  sourceListAt=Date.now();
  request('GET','/v2/source-state',null,function(error,result){
    if(error||!result||!result.sequences){referenceSequence=null;render();return}
    referenceSequence=result.activeSequence&&/^NAJM_(EDIT|TEST)_\d+$/.test(result.activeSequence.name)?result.activeSequence:null;
    var select=el('sources'),testSelect=el('studio-sources'),selected=select.value,testSelected=testSelect.value,first='';select.textContent='';testSelect.textContent='';
    result.sequences.forEach(function(item){if(/^NAJM_(EDIT|TEST)_\d+$/.test(item.name)||item.videoClipCount===0||item.audioClipCount===0)return;if(!first)first=item.id;var option=document.createElement('option');option.value=item.id;option.textContent=item.name;select.appendChild(option);var testOption=document.createElement('option');testOption.value=item.id;testOption.textContent=item.name;testSelect.appendChild(testOption)});
    var original=function(id){return result.sequences.some(function(item){return item.id===id&&!/^NAJM_(EDIT|TEST)_\d+$/.test(item.name)&&item.videoClipCount!==0&&item.audioClipCount!==0})};
    select.value=selected&&original(selected)?selected:source&&original(source.id)?source.id:first;testSelect.value=testSelected&&original(testSelected)?testSelected:select.value;render();
  });
}
function refresh(){
  var epoch=connectionEpoch;
  if(!healthBusy){healthBusy=true;var healthId=++healthRequest;
  request('GET','/v2/health',null,function(error,result){
    if(healthId!==healthRequest||epoch!==connectionEpoch)return;
    healthBusy=false;
    if(error){engineOnline=false;ready=false;health=null;healthAt=0;statusAt=0;setupProgress('Local engine check failed: '+String(error),false);render();engineStart();return}
    engineOnline=true;health=result;healthAt=Date.now();engineAttempts=0;
    if(actionFailure.indexOf('Engine startup:')===0)actionFailure='';
    if(!connected)connect();refreshSources();if(!agentsLoaded)refreshAgents();else if(selectedAgentId)refreshTraining(false);render();
  });}
  if(statusBusy)return;statusBusy=true;var requestId=++statusRequest;
  request('GET','/v2/status',null,function(error,result){
    if(requestId!==statusRequest||epoch!==connectionEpoch)return;
    statusBusy=false;
    if(error){ready=false;statusAt=0;setupProgress('Premiere project check failed: '+String(error),false);render();return}
    statusAt=Date.now();var previousSource=sourceIdentity,projectChanged=currentProjectPath!==(result.projectPath||'');currentProjectPath=result.projectPath||'';
    source=result.source||null;
    sourceIdentity=source?(result.projectPath||'')+'|'+source.id:'';loadedAgentId=result.loadedAgent&&result.loadedAgent.id||'';loadedAgentVersion=result.loadedAgent&&result.loadedAgent.version||0;loadedProjectPath=loadedAgentId?result.projectPath||'':'';
    if(projectChanged){trainingAt=0;refreshTraining(true)}
    if(previousSource!==sourceIdentity){projectSnapshot=null;clearReference();sourceListAt=0;healthAt=0;healthBusy=false;healthRequest++;refreshSources();refresh()}
    if(source&&briefSourceId!==sourceIdentity){briefSourceId=sourceIdentity;briefDraft='';el('brief').value=''}
    if(source&&(!projectSnapshot||projectSnapshot.id!==source.id))request('GET','/v2/source-snapshot?sequenceId='+encodeURIComponent(source.id),null,function(snapshotError,snapshot){if(!snapshotError&&snapshot&&snapshot.id===source.id){projectSnapshot=snapshot;if(document.createElement){var audioSelect=el('caption-audio-track');audioSelect.textContent='';var allOption=document.createElement('option');allOption.value='';allOption.textContent='All audio tracks';audioSelect.appendChild(allOption);(snapshot.audioTracks||[]).forEach(function(track){if(!track.clips||!track.clips.length)return;var option=document.createElement('option');option.value=String(track.index);option.textContent='A'+(Number(track.index)+1)+' ? '+track.clips.length+' clips';audioSelect.appendChild(option)})}render()}});
    if(!source)projectSnapshot=null;
    cachePlan=result.cachePlan||null;agentLoadProgress=result.agentLoad||null;
    job=result.job&&source&&result.job.sourceSequenceId===source.id&&result.job.projectPath===result.projectPath?result.job:null;
    usage=job?result.usage:null;stageInfo=job?result.runStages:null;
    if(job&&job.brief)briefDraft=job.brief;
    ready=!!result.ready;
    render();
  });
}
function action(path,body){
  if(acting)return;acting=true;actionFailure='';render();
  request('POST',path,body||{},function(error){acting=false;if(error)actionFailure=String(error);refresh();render()});
}
el('retry').onclick=function(){if(acting)return;actionFailure='';engineAttempts=0;engineStartAt=0;if(socket&&!connected){try{socket.close()}catch(_){}}if(!engineOnline)engineStart();connect();refresh()};
el('brief').oninput=function(){briefDraft=el('brief').value;el('brief-count').textContent=briefDraft.length+' / 8000'};
el('agent-select').onchange=function(){modifyingStyle=false;agentLoadProgress=null;loadedAgentId='';loadedAgentVersion=0;selectedAgentId=el('agent-select').value||'';clearReference();trainingSession=null;trainingTestResult=null;agentCompatibility=null;trainingAt=0;try{if(window.localStorage)window.localStorage.setItem('najm-v2-agent-id',selectedAgentId)}catch(_){}editAgent(selectedAgent());refreshTraining(true);render()};
el('agent-load').onclick=function(){var agent=selectedAgent();if(!agent||!(agent.approvedTraining||agent.learnedTraining)||el('agent-load').disabled)return;agentBusy=true;agentLoadProgress=null;el('agent-memory-status').textContent='Loading saved knowledge and checking project media...';render();request('POST','/v2/agents/load',{agentId:agent.id,version:agent.version},function(error,result){agentBusy=false;if(error||!result||!result.ready){agentLoadProgress={state:'FAILED',error:String(error||'Readiness was not verified')};render();return}loadedAgentId=agent.id;loadedAgentVersion=agent.version;loadedProjectPath=result.projectPath||'';el('agent-memory-status').textContent='Loaded '+agent.name+' with '+result.executableRules.length+' executable rules. Source: '+result.sourceName;refresh();render()})};
el('agent-new').onclick=function(){modifyingStyle=false;agentLoadProgress=null;loadedAgentId='';loadedAgentVersion=0;selectedAgentId='';el('agent-select').value='';clearReference();trainingSession=null;agentCompatibility=null;trainingAt=0;try{if(window.localStorage)window.localStorage.setItem('najm-v2-agent-id','')}catch(_){}editAgent(null);el('agent-form').open=true;el('agent-name').focus&&el('agent-name').focus();render()};
el('agent-save').onclick=function(){
  if(agentBusy||referenceBusy||state()==='RUNNING')return;
  var body={name:el('agent-name').value,description:el('agent-description').value,instructions:el('agent-instructions').value,draft:true},current=selectedAgent();
  if(agentEditorId){body.id=agentEditorId;body.version=agentEditorVersion}
  if(current&&current.id===agentEditorId&&current.version===agentEditorVersion&&body.name.trim()===current.name&&body.description.trim()===current.description&&body.instructions.trim()===current.instructions){el('agent-error').textContent='';el('agent-save-status').textContent='Already saved as draft v'+current.version+'. No changes to save.';return}
  agentBusy=true;el('agent-error').textContent='';el('agent-save-status').textContent='Saving draft agent…';render();
  request('POST','/v2/agents',body,function(error,result){
    agentBusy=false;
    if(error||!result||!result.id){el('agent-error').textContent=String(error||'Could not save agent');el('agent-save-status').textContent='Save failed.';render();return}
    agents=agents.filter(function(agent){return agent.id!==result.id});agents.push(result);selectedAgentId=result.id;
    try{if(window.localStorage)window.localStorage.setItem('najm-v2-agent-id',selectedAgentId)}catch(_){}
    renderAgentList();editAgent(result);trainingSession=null;agentCompatibility=null;trainingAt=0;refreshTraining(true);el('agent-save-status').textContent='Saved draft agent v'+result.version+'.';render()
  })
};
['agent-name','agent-description','agent-instructions'].forEach(function(id){el(id).oninput=function(){el('agent-save-status').textContent='Unsaved changes.';el('agent-error').textContent='';renderReference()}});
el('reference-analyze').onclick=function(){var agent=selectedAgent(),identity=sourceIdentity;if(!agent||el('reference-analyze').disabled)return;referenceBusy=true;referenceReport=null;el('reference-message').textContent='Reading the active sequence through Premiere Direct…';render();request('GET','/v2/reference-analysis?nonce='+Date.now(),null,function(error,result){referenceBusy=false;if(selectedAgentId!==agent.id||sourceIdentity!==identity){clearReference();el('reference-message').textContent='Agent or source changed during analysis. Analyze the current timeline again.';render();return}if(error||!result||!result.report){el('reference-message').textContent='Analysis failed: '+String(error||'No reference report returned');render();return}referenceReport={analysisId:result.analysisId,report:result.report,agentId:agent.id,agentVersion:agent.version};el('reference-shot-ms').value=result.report.proposed?String(result.report.proposed.targetShotDurationMs):'';el('reference-message').textContent='Read-only analysis complete. Review the evidence and edit the shot target before approval.';render()})};
el('reference-shot-ms').oninput=render;
el('reference-approve').onclick=function(){var report=referenceReport,agent=selectedAgent();if(!report||!agent||el('reference-approve').disabled)return;referenceBusy=true;el('reference-message').textContent='Verifying the source has not changed and saving the approved style memory…';render();request('POST','/v2/agents/reference-approval',{agentId:agent.id,agentVersion:agent.version,analysisId:report.analysisId,targetShotDurationMs:Number(el('reference-shot-ms').value)},function(error,result){referenceBusy=false;if(error||!result||!result.id){el('reference-message').textContent='Approval failed: '+String(error||'No saved agent returned');render();return}agents=agents.filter(function(item){return item.id!==result.id});agents.push(result);selectedAgentId=result.id;referenceReport=null;renderAgentList();editAgent(result);el('reference-message').textContent=(result.approvedReference&&result.approvedReference.styleMemory?'Structural timeline style memory':'Pacing preference')+' saved in draft agent v'+result.version+'. It applies to V2 TEST planning.';render()})};
el('test-start').oninput=render;el('test-end').oninput=render;
el('test-suggest').onclick=function(){if(el('test-suggest').disabled)return;el('test-suggestion-note').textContent='Checking saved story…';request('GET','/v2/test-section-suggestion',null,function(error,result){if(error){el('test-suggestion-note').textContent=String(error);return}if(result&&result.section){el('test-start').value=String(result.section.start);el('test-end').value=String(result.section.end)}el('test-suggestion-note').textContent=result&&result.explanation||'No suggestion available';render()})};
el('agent-test').onclick=function(){el('studio-error').textContent='Use Prepare TEST and Apply TEST in the Agent Training Studio.'};
el('studio-learn').onclick=function(){var agent=selectedAgent();if(!agent||el('studio-learn').disabled)return;trainingAction('/v2/training/learn',{agentId:agent.id,agentVersion:agent.version})};
el('studio-cancel-learn').onclick=function(){var agent=selectedAgent();if(!agent||el('studio-cancel-learn').disabled)return;trainingCancelling=true;render();request('POST','/v2/training/cancel',{agentId:agent.id},function(error){if(error){trainingCancelling=false;el('studio-error').textContent=String(error)}else el('studio-operation').textContent='Stopping local reference analysis';refreshTraining(true);render()})};
el('studio-answer-submit').onclick=function(){var question=trainingSession&&trainingSession.questions.filter(function(x){return !x.answered})[0];if(!question)return;trainingAction('/v2/training/answer',{sessionId:trainingSession.id,questionId:question.id,answer:el('studio-answer').value,reason:el('studio-answer-reason').value||''},function(){el('studio-answer-reason').value=''})};
el('studio-test-start').oninput=render;el('studio-test-end').oninput=render;
el('studio-sources').onchange=render;
el('studio-open-source').onclick=function(){if(!el('studio-open-source').disabled)action('/v2/activate-source?sequenceId='+encodeURIComponent(el('studio-sources').value))};
el('studio-suggest').onclick=function(){if(!trainingSession||el('studio-suggest').disabled)return;request('GET','/v2/training/suggest?sessionId='+encodeURIComponent(trainingSession.id),null,function(error,result){if(error){el('studio-error').textContent=String(error);return}if(!result||!result.section){el('studio-pending').textContent=result&&result.explanation||'No matching saved story is available; enter a manual range.';return}el('studio-test-start').value=result.section.start;el('studio-test-end').value=result.section.end;el('studio-pending').textContent=result.explanation||'Review this range, then prepare TEST.';render()})};
el('studio-prepare').onclick=function(){if(!trainingSession||el('studio-prepare').disabled)return;trainingAction('/v2/training/prepare',{sessionId:trainingSession.id},function(result){if(!result||!result.session||!result.session.pendingTest)return;trainingAction('/v2/training/apply',{sessionId:result.session.id,token:result.session.pendingTest.token},function(){modifyingStyle=false;refresh()})})};
el('studio-apply').onclick=function(){if(!trainingSession||!trainingSession.pendingTest||el('studio-apply').disabled)return;trainingAction('/v2/training/apply',{sessionId:trainingSession.id,token:trainingSession.pendingTest.token},function(){refresh()})};
el('studio-modify').onclick=function(){modifyingStyle=true;render()};
el('studio-update-button').onclick=function(){if(!trainingSession||el('studio-update-button').disabled)return;trainingAction('/v2/training/update',{sessionId:trainingSession.id})};
el('studio-correction-reason').oninput=render;
el('studio-confirm-correction').onclick=function(){if(!trainingSession||el('studio-confirm-correction').disabled)return;trainingAction('/v2/training/confirm-correction',{sessionId:trainingSession.id,reason:el('studio-correction-reason').value,accept:el('studio-correction-accept').value==='yes'})};
el('studio-approve').onclick=function(){if(!trainingSession||el('studio-approve').disabled)return;trainingAction('/v2/training/approve',{sessionId:trainingSession.id})};
el('open-sequence').onclick=function(){action('/v2/open-generated')};
el('sources').onchange=function(){render()};
el('activate').onclick=function(){if(!el('activate').disabled)action('/v2/activate-source?sequenceId='+encodeURIComponent(el('sources').value))};
el('edit-mode').onchange=render;
el('caption-audio-track').onchange=render;
el('general-auto').onclick=function(){if(!el('general-auto').disabled)action('/v2/auto-edit',{brief:el('brief').value||''})};
el('auto').onclick=function(){if(el('auto').disabled||el('auto').hidden)return;if(state()==='COMPLETED'){briefDraft='';el('brief').value='';action('/v2/new-edit')}else{var payload={brief:el('brief').value||''};if(selectedAgentId)payload.agentId=selectedAgentId;if(captionsMode()&&el('caption-audio-track').value!=='')payload.audioTrackIndex=Number(el('caption-audio-track').value);action(captionsMode()?'/v2/captions-only':'/v2/auto-edit',payload)}};
el('resume').onclick=function(){if(!el('resume').disabled&&!el('resume').hidden)action('/v2/resume')};
el('discard').onclick=function(){if(!el('discard').disabled&&!el('discard').hidden&&window.confirm&&window.confirm('Discard this run? Reusable caches will be kept.'))action('/v2/discard',{runId:job&&job.id})};
el('cancel').onclick=function(){if(!el('cancel').disabled&&!el('cancel').hidden)action('/v2/cancel')};
connect();refresh();setInterval(refresh,2000);setInterval(updateElapsed,1000);setInterval(function(){if(!viewModel().eligible)setupProgress(setupLabel,setupPending)},1000);
})();
