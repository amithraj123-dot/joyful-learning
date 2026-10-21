import {spawn} from 'node:child_process';
import path from 'node:path';
export function windowsBridge(script){
 if(process.platform!=='win32')return {call:async()=>{throw Error('This feature requires Windows.');},close:()=>{}};
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const child=spawn(executable,['-NoProfile','-NonInteractive','-File',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let sequence=0,buffer='';const pending=new Map();
 const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('The Windows helper is unavailable. Check your PowerShell policy.'));}pending.clear();};
 child.stdout.on('data',data=>{buffer+=data.toString();let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const d=JSON.parse(line),p=pending.get(d.id);if(!p)continue;pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error)):p.resolve(d.result);}catch{}}});child.stderr.on('data',()=>{});child.on('error',fail);child.on('exit',fail);
 return {call:(action,args={})=>new Promise((resolve,reject)=>{if(!['focus','paste','selection','clipboardSequence','call','holdKey','verifyInstaller'].includes(action)){reject(Error('Unknown Windows operation.'));return;}const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Windows did not respond in time.'));},8000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,action,...args})+'\n',e=>{if(e){clearTimeout(timer);pending.delete(id);reject(Error('Windows helper is unavailable.'));}});}),close:()=>{child.kill();fail();}};
}
