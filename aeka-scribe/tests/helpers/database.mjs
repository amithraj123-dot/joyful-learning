import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function database(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../../drizzle/'+file,import.meta.url),'utf8'));
 const bind=(query,params)=>({_run:()=>({meta:{changes:Number(sql.prepare(query).run(...params).changes)}}),first:async()=>sql.prepare(query).get(...params)||null,all:async()=>({results:sql.prepare(query).all(...params)}),run:async()=>({meta:{changes:Number(sql.prepare(query).run(...params).changes)}})});
 return {sql,prepare:query=>({bind:(...params)=>bind(query,params)}),batch:async statements=>{sql.exec('BEGIN');try{const results=statements.map(s=>s._run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
