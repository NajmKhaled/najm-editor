import {existsSync} from 'node:fs';import {isAbsolute} from 'node:path';
export function installedBrowser(){
 const explicit=process.env.NAJM_BROWSER_PATH;
 if(explicit){if(!isAbsolute(explicit)||!existsSync(explicit))throw Error('LOCAL_BROWSER_UNAVAILABLE: configured browser does not exist');return explicit;}
 const choices=process.platform==='win32'?['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe']:['/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/chromium-browser'];
 const found=choices.find(existsSync);if(!found)throw Error('LOCAL_BROWSER_UNAVAILABLE: install a Chromium browser explicitly; Najm never downloads one');return found;
}
export async function openLocalBrowser(){
 const moduleName='playwright-core';let pw:any;try{pw=await import(moduleName)}catch{throw Error('OPTIONAL_RENDERER_UNAVAILABLE: install playwright-core to use local HTML rendering');}
 return pw.chromium.launch({executablePath:installedBrowser(),headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
}
