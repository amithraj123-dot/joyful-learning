import crypto from 'node:crypto';
import {isTrashed,noteDetails} from '../generated/note-details.mjs';
const model='text-embedding-3-small',dimensions=256;
const eligible=n=>!isTrashed(n)&&n.status!=='recording';
export function semanticText(n){const d=noteDetails(n);return [n.title,n.body,n.segments.map(s=>s.text).join('\n'),d.context.map(x=>x.name+'\n'+x.text).join('\n')].join('\n').slice(0,6000);}
const hash=n=>crypto.createHash('sha256').update(semanticText(n)).digest('hex');
const norm=v=>Math.sqrt(v.reduce((n,x)=>n+x*x,0));
export function createSemantic({vault,getNotes,getKey,permitted=()=>true,fetcher=fetch,emit=()=>{}}){
 let running=false,cancelled=false,lock=Promise.resolve();const serial=fn=>{const p=lock.then(fn);lock=p.catch(()=>{});return p;};
 const read=()=>vault.read('semantic-index',{enabled:false,records:[],updatedAt:0});
 const current=async()=>{const notes=(await getNotes()).filter(eligible);return {notes,hashes:new Map(notes.map(n=>[n.id,hash(n)]))};};
 const status=async()=>{const index=await read(),{notes,hashes}=await current();return {enabled:index.enabled,running,indexed:index.records.filter(r=>hashes.get(r.id)===r.hash).length,total:notes.length,updatedAt:index.updatedAt,model};};
 const embed=async inputs=>{if(!permitted())throw Error('Cloud AI is disabled by managed policy.');const key=await getKey();if(!key)throw Error('Connect OpenAI before indexing notes.');const r=await fetcher('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model,dimensions,encoding_format:'float',input:inputs}),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Semantic search could not reach OpenAI. Check your key and quota.');const d=await r.json();if(!Array.isArray(d.data)||d.data.length!==inputs.length)throw Error('Invalid embedding response.');const values=Array(inputs.length);for(const x of d.data){if(!Number.isInteger(x.index)||x.index<0||x.index>=inputs.length||values[x.index]||!Array.isArray(x.embedding)||x.embedding.length!==dimensions||!x.embedding.every(Number.isFinite)||!norm(x.embedding))throw Error('Invalid embedding response.');const length=norm(x.embedding);values[x.index]=x.embedding.map(n=>n/length);}return values;};
 const prune=()=>serial(async()=>{const index=await read(),{hashes}=await current();index.records=index.records.filter(r=>hashes.get(r.id)===r.hash);await vault.write('semantic-index',index);});
 const build=async()=>{
  if(running)throw Error('Indexing is already running.');if(!permitted())throw Error('Cloud AI is disabled by managed policy.');running=true;cancelled=false;
  try{const {notes}=await current(),initial=await read(),old=new Map(initial.records.map(r=>[r.id,r])),pending=notes.filter(n=>old.get(n.id)?.hash!==hash(n));await prune();
   for(let i=0;i<pending.length;i+=8){if(cancelled)break;const batch=pending.slice(i,i+8),vectors=await embed(batch.map(semanticText));if(cancelled)break;await serial(async()=>{if(cancelled)return;const latest=await read(),{hashes}=await current(),records=new Map(latest.records.filter(r=>hashes.get(r.id)===r.hash).map(r=>[r.id,r]));batch.forEach((n,j)=>{if(hashes.get(n.id)===hash(n))records.set(n.id,{id:n.id,hash:hash(n),vector:vectors[j]});});await vault.write('semantic-index',{...latest,records:[...records.values()],updatedAt:Date.now()});});emit('semantic-progress',{});}
  }finally{running=false;emit('semantic-progress',{});}return status();
 };
 const configure=enabled=>serial(async()=>{if(typeof enabled!=='boolean')throw Error('Invalid semantic search setting.');if(enabled&&!permitted())throw Error('Cloud AI is disabled by managed policy.');const index=await read();await vault.write('semantic-index',{...index,enabled});return {enabled};});
 const clear=async()=>{cancelled=true;await serial(()=>vault.write('semantic-index',{enabled:false,records:[],updatedAt:0}));return status();};
 const rank=async(notes,question)=>{
  const index=await read();if(!index.enabled)return null;if(typeof question!=='string'||question.length>6000||!question.trim())return null;
  const allowed=notes.filter(eligible),byId=new Map(allowed.map(n=>[n.id,n])),fresh=index.records.filter(r=>byId.has(r.id)&&hash(byId.get(r.id))===r.hash);if(!fresh.length)throw Error('Refresh the semantic index in Desktop settings, or turn semantic search off.');
  const [query]=await embed([question]),semantic=fresh.map(r=>({id:r.id,score:r.vector.reduce((sum,x,i)=>sum+x*query[i],0)})).sort((a,b)=>b.score-a.score).slice(0,24),terms=question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];
  const lexical=allowed.map(n=>({id:n.id,score:terms.reduce((s,t)=>s+(semanticText(n).toLowerCase().includes(t)?1:0),0)})).sort((a,b)=>b.score-a.score).filter(x=>x.score>0).slice(0,24),scores=new Map();for(const ranking of [semantic,lexical])ranking.forEach((r,i)=>scores.set(r.id,(scores.get(r.id)||0)+1/(60+i+1)));
  return {ids:[...scores].sort((a,b)=>b[1]-a[1]).map(x=>x[0]).slice(0,24),indexed:fresh.length};
 };
 return {status,build,configure,clear,prune,rank,cancel:()=>{cancelled=true;return {cancelled:true};}};
}
