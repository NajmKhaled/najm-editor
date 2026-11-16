import {resolvePythonRuntime} from './python-runtime.js';
const result=await resolvePythonRuntime();
console.log(JSON.stringify(result));
if(result.source==='unavailable'||!result.whisperAvailable||!result.torchAvailable)process.exitCode=1;
