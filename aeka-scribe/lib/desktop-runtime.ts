import {isTrashed} from './note-details';
import {encodeWav,upsertSegment,type Note} from './workspace-core';
export type DesktopEvent={type:string;[key:string]:unknown};
declare global {interface Window {flowDesktop?:{invoke:(action:string,payload?:unknown)=>Promise<any>;on:(callback:(event:DesktopEvent)=>void)=>()=>void}}}
export const isDesktop=()=>typeof window!=='undefined'&&!!window.flowDesktop;
export async function runtime(action:string,payload:any={}){
 if(isDesktop())return window.flowDesktop!.invoke(action,payload);
 if(action.startsWith('cloud.'))return cloudRuntime(action.slice(6),payload);
 if(action==='status'){const r=await fetch('/api/status');if(!r.ok)throw Error('Could not check the AI connection.');return r.json();}
 if(action==='queue.add')return addAudio(payload);
 if(action==='queue.list')return (await readAudio()).map(({audioBuffer,...v})=>v);
 if(action==='queue.retry'){void processAudio();return true;}
 if(action==='audio.clear'){await clearAudio();return true;}
 if(action==='recording.state')return true;
 if(action==='calendar.events')return {events:[],errors:[],refreshedAt:null};
 if(action==='calendar.status')return [];
 const r=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
 const result=await r.json() as {value?:unknown;error?:string;signInPath?:string};if(!r.ok)throw Object.assign(Error(result.error||'Workspace request failed.'),{signInPath:result.signInPath||''});if(action==='notes.delete'){for(const item of await readAudio())if(item.noteId===payload.id)await removeAudio(item.id);window.dispatchEvent(new Event('flow-queue-changed'));}return result.value;
}
export async function transcribeAudio(file:File,language:string,context:string,keywords:string[],signal?:AbortSignal){
 if(isDesktop()){const status=await runtime('status');let bytes=await file.arrayBuffer(),name=file.name,mime=file.type;if(status.settings?.asrEngine==='local'){const ac=new AudioContext();try{const decoded=await ac.decodeAudioData(bytes);if(decoded.duration>300)throw Error('Local audio is limited to five minutes per request.');const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();const rendered=await offline.startRendering();bytes=encodeWav(rendered.getChannelData(0),16000);name='dictation.wav';mime='audio/wav';}finally{await ac.close();}}const result=await window.flowDesktop!.invoke('transcribe',{audioBuffer:bytes,filename:name,mime,language:language.split('-')[0],context,keywords});return {...result,engine:status.settings?.asrEngine==='local'?'Local Whisper':'gpt-transcribe'};}
 const form=new FormData();form.set('audio',file);form.set('language',language);form.set('context',context);form.set('keywords',JSON.stringify(keywords));const r=await fetch('/api/transcribe',{method:'POST',body:form,signal});const d=await r.json() as {text?:string;error?:string};if(!r.ok)throw Error(d.error||'Transcription failed.');return d;
}
type PendingAudio={id:string;noteId:string;audioBuffer:ArrayBuffer;start:number;end:number;language:string;keywords:string[];error?:string};
let dbPromise:Promise<IDBDatabase>|null=null,processing=false;
function audioDB(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('flow-meeting-audio-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('chunks',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>{dbPromise=null;reject(Error('Local audio storage is unavailable. Recording has been stopped to protect your audio.'));};});return dbPromise;}
async function storeAudio<T>(mode:IDBTransactionMode,run:(s:IDBObjectStore)=>IDBRequest<T>){const db=await audioDB();return new Promise<T>((resolve,reject)=>{const tx=db.transaction('chunks',mode),request=run(tx.objectStore('chunks'));let result:T;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(Error('Local audio could not be saved. Free storage and try again.'));});}
const readAudio=()=>storeAudio('readonly',s=>s.getAll()) as Promise<PendingAudio[]>;
const removeAudio=(id:string)=>storeAudio('readwrite',s=>s.delete(id));
const clearAudio=()=>storeAudio('readwrite',s=>s.clear());
async function addAudio(p:PendingAudio){await storeAudio('readwrite',s=>s.put(p));window.dispatchEvent(new Event('flow-queue-changed'));void processAudio();return {saved:true};}
export async function processAudio(){if(processing||isDesktop())return;processing=true;try{const status=await runtime('status');if(!status.openaiConfigured)return;for(const item of await readAudio()){
  try{const data=await transcribeAudio(new File([item.audioBuffer],'meeting.wav',{type:'audio/wav'}),item.language,'',item.keywords);if(!(await readAudio()).some(x=>x.id===item.id))continue;let saved=false;for(let attempt=0;attempt<3;attempt++){const all=await runtime('notes.list') as Note[],note=all.find(n=>n.id===item.noteId);if(!note||isTrashed(note)){await removeAudio(item.id);saved=true;break;}const next={...note,duration:Math.max(note.duration,item.end),segments:upsertSegment(note.segments,{id:item.id,start:item.start,end:item.end,text:data.text||'',speaker:''})};try{await runtime('notes.save',{note:next,baseUpdatedAt:note.updatedAt});saved=true;break;}catch(e){if(attempt===2)throw e;}}
   if(saved)await removeAudio(item.id);window.dispatchEvent(new Event('flow-notes-changed'));
  }catch(e){await storeAudio('readwrite',s=>s.put({...item,error:e instanceof Error?e.message:'Transcription failed.'}));break;}
 }}catch{/* Keep the durable queue intact until the next explicit retry. */}finally{processing=false;window.dispatchEvent(new Event('flow-queue-changed'));}}

export async function cloudRuntime(action:string,payload:any={}){if(isDesktop())return window.flowDesktop!.invoke('cloud.request',{action,...payload});const r=await fetch('/api/cloud',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});const d=await r.json() as {error?:string;signInPath?:string;value?:unknown};if(!r.ok)throw Object.assign(Error(d.error||'Cloud request failed.'),{signInPath:d.signInPath||''});return d.value as any;}
