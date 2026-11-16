import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve, win32} from 'node:path';

export interface PythonRuntime {command:string;prefixArgs:string[];executable:string;version:string;whisperAvailable:boolean;torchAvailable:boolean;pillowAvailable:boolean;cachedModels:string[];source:'central'|'unavailable';error?:string}
export type SpawnRunner=(command:string,args:string[],timeoutMs?:number)=>Promise<{stdout:string;stderr:string;code:number|null}>;
export function assertNoBarePython(command:string,context:string){if(/^(?:python|py)(?:\.exe)?$/i.test(command.trim()))throw Error(`BARE_PYTHON_BLOCKED: executable=${command}; caller=${context}`)}
export function configuredPythonExecutable(settings:Record<string,any>=readSettings()){const value=String(settings.pythonExecutable||'');if(!win32.isAbsolute(value)||win32.basename(value).toLowerCase()!=='python.exe')throw Error('Configured Python must be an absolute path to python.exe');return value}
export function assertPythonExecutableAllowed(command:string,context:string){assertNoBarePython(command,context);if(resolve(command).toLowerCase()!==resolve(configuredPythonExecutable()).toLowerCase())throw Error(`NON_CENTRAL_PYTHON_BLOCKED: executable=${command}; caller=${context}`)}
function launch(command:string,args:string[],context:string,options:Parameters<typeof spawn>[2]={}){assertPythonExecutableAllowed(command,context);console.log(`[python-launch] installation-pinned interpreter; caller=${context}`);return spawn(command,args,options)}
const defaultRunner:SpawnRunner=(command,args,timeoutMs=20000)=>new Promise((resolvePromise,reject)=>{let stdout='',stderr='';let p:ChildProcessWithoutNullStreams;try{p=launch(command,args,'resolver probe',{windowsHide:true,shell:false,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},stdio:'pipe'}) as ChildProcessWithoutNullStreams}catch(e){reject(e);return}p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);const timer=setTimeout(()=>{p.kill();reject(Error('Python runtime check timed out'))},timeoutMs);p.on('error',e=>{clearTimeout(timer);reject(e)});p.on('close',code=>{clearTimeout(timer);resolvePromise({stdout,stderr,code})})});
const root=process.cwd(),settingsFile=join(root,'config','settings.json'),cacheFile=join(root,'config','python-runtime-cache.json');let runtimePromise:Promise<PythonRuntime>|undefined;
export function readSettings():Record<string,any>{try{return JSON.parse(readFileSync(settingsFile,'utf8'))}catch{return {}}}
export function getWhisperModel(){const model=String(readSettings().whisperModel||'small');return ['tiny','base','small','medium'].includes(model)?model:'small'}
export function updateSettings(patch:Record<string,unknown>){const current=readSettings(),next={...current,...patch};if(next.whisperModel&&!['tiny','base','small','medium'].includes(String(next.whisperModel)))throw Error('Whisper model must be tiny, base, small, or medium');next.pythonExecutable=configuredPythonExecutable(next);mkdirSync(join(root,'config'),{recursive:true});writeFileSync(settingsFile,JSON.stringify(next,null,2),'utf8');runtimePromise=undefined;return next}
export function isModelCached(model:string,userHome=homedir()){return cachedWhisperModels(userHome).includes(model)||existsSync(join(userHome,'.cache','huggingface','hub','models--Systran--faster-whisper-'+model))}
export function cachedWhisperModels(userHome=homedir()){const dir=join(userHome,'.cache','whisper');return ['tiny','base','small','medium'].filter(m=>existsSync(join(dir,m+'.pt')))}
function parseVersion(text:string){return text.match(/(\d+\.\d+\.\d+)/)?.[1]||text.trim()}
async function probe(runner:SpawnRunner){const executable=configuredPythonExecutable();if(!existsSync(executable))throw Error(`Configured Python executable does not exist: ${executable}`);const code='import sys, json, importlib.util; print(json.dumps({"executable":sys.executable,"version":sys.version.split()[0],"whisper":importlib.util.find_spec("whisper") is not None,"torch":importlib.util.find_spec("torch") is not None,"pillow":importlib.util.find_spec("PIL") is not None}))';const result=await runner(executable,['-c',code]);if(result.code!==0)throw Error((result.stderr||'Python validation failed').trim());const line=result.stdout.trim().split(/\r?\n/).filter(x=>x.startsWith('{')).at(-1);if(!line)throw Error('Interpreter did not return validation JSON');const value=JSON.parse(line);if(resolve(value.executable).toLowerCase()!==resolve(executable).toLowerCase())throw Error(`Interpreter identity mismatch: ${value.executable}`);return {executable,version:parseVersion(value.version),whisperAvailable:!!value.whisper,torchAvailable:!!value.torch,pillowAvailable:!!value.pillow}}
function cache(runtime:PythonRuntime){mkdirSync(join(root,'config'),{recursive:true});writeFileSync(cacheFile,JSON.stringify({command:runtime.executable,prefixArgs:[],executable:runtime.executable,version:runtime.version},null,2),'utf8')}
export function buildPythonArgs(_runtime:Pick<PythonRuntime,'prefixArgs'>,args:string[]){return args}
export async function resolvePythonRuntimeFromCandidates(_candidates:unknown[]=[],runner:SpawnRunner=defaultRunner,cachedModels=cachedWhisperModels(),persist=false):Promise<PythonRuntime>{try{const p=await probe(runner);const runtime:PythonRuntime={command:p.executable,prefixArgs:[],...p,cachedModels,source:'central'};if(!runtime.whisperAvailable||!runtime.torchAvailable||!runtime.pillowAvailable)throw Error('Required imports missing: '+[!runtime.whisperAvailable?'whisper':null,!runtime.torchAvailable?'torch':null,!runtime.pillowAvailable?'PIL':null].filter(Boolean).join(', '));if(persist)cache(runtime);return runtime}catch(e){return {command:'',prefixArgs:[],executable:'',version:'',whisperAvailable:false,torchAvailable:false,pillowAvailable:false,cachedModels,source:'unavailable',error:String(e)}}}
export function resolvePythonRuntime(runner:SpawnRunner=defaultRunner){if(!runtimePromise)runtimePromise=resolvePythonRuntimeFromCandidates([],runner,cachedWhisperModels(),true);return runtimePromise}
export async function runPython(args:string[],options:{signal?:AbortSignal;timeoutMs?:number;cwd?:string;onStderr?:(chunk:string)=>void;onActivity?:()=>void;onSpawn?:(pid:number|undefined)=>void}={}){
  const runtime=await resolvePythonRuntime();
  if(runtime.source==='unavailable')throw Error('Python runtime unavailable: '+runtime.error);
  const child=launch(runtime.executable,args,'runPython',{cwd:options.cwd||root,windowsHide:true,shell:false,signal:options.signal,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},stdio:'pipe'});
  options.onSpawn?.(child.pid);
  let stdout='',stderr='',timedOut=false;
  child.stdout?.setEncoding('utf8');child.stderr?.setEncoding('utf8');
  child.stdout?.on('data',part=>{stdout+=part;options.onActivity?.()});
  child.stderr?.on('data',part=>{const chunk=String(part);stderr+=chunk;options.onStderr?.(chunk);options.onActivity?.()});
  return await new Promise<{stdout:string;stderr:string;code:number|null}>((yes,no)=>{
    const timer=setTimeout(()=>{timedOut=true;child.kill()},options.timeoutMs||3600000);
    child.on('error',error=>{clearTimeout(timer);no(error)});
    child.on('close',code=>{clearTimeout(timer);const result={stdout,stderr,code};if(code!==0)no(Error('Python '+runtime.version+(timedOut?' timed out':' exited '+code)+': '+stderr.slice(-2500)));else yes(result)})
  });
}
