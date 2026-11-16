import type {DirectPremiereBridge} from './direct-bridge.js';
import {recoverableCall} from './recovery.js';
/** Called only after local media/alpha verification. Overlay gets its own owned track. */
export async function placeRenderedOverlay(bridge:DirectPremiereBridge,args:{runId:string;sequenceId:string;sourceSequenceId:string;targetReceiptPath:string;trackIndex:number;path:string;start:number;end:number},signal?:AbortSignal){
 signal?.throwIfAborted();return recoverableCall(bridge,'applyOverlayBatch',args,signal);
}
