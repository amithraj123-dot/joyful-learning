import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,formatText,replacePhrases,pruneHistory,reviewChanges,sanitizeKeywords,validateBackup} from '../lib/flow-core.ts';
import {transcribe} from '../lib/transcription.ts';
test('Cleanup keeps amounts, negation, and intentional repetition',()=>{
 const raw='um do not file 12,50,000. No no changes to 7.5% or 194J. The museum stays.';
 const result=formatText(raw,defaults,[],[]).text;
 assert.equal(result,'do not file 12,50,000. No no changes to 7.5% or 194J. The museum stays.');
 assert.equal(reviewChanges(raw,result),false);
 assert.equal(reviewChanges(raw,result.replace('12,50,000','15,00,000')),true);
 assert.equal(reviewChanges(raw,result.replace('not','')),true);
 assert.equal(reviewChanges('Rate 7.5%', 'Rate 7.5'),true);
 assert.equal(reviewChanges('Loss -100', 'Loss 100'),true);
});
test('Verbatim output is byte-for-byte unchanged',()=>{const raw='  um aeka\n12,50,000';assert.equal(formatText(raw,{...defaults,style:'verbatim',expandSnippets:true},[{id:'a',phrase:'aeka',replacement:'Aeka'}],[]).text,raw);});
test('Longest complete phrases win and replacements do not cascade',()=>{
 assert.equal(replacePhrases('tax taxation A+B Aekas Aeka Advisors Aeka',[{from:'tax',to:'GST'},{from:'GST',to:'wrong'},{from:'A+B',to:'SUM'},{from:'Aeka',to:'Firm'},{from:'Aeka Advisors',to:'Aeka Advisors LLP'}]).text,'GST taxation SUM Aekas Aeka Advisors LLP Firm');
 assert.equal(replacePhrases('ಕರ ಕರ್ನಾಟಕ',['ಕರ'].map(from=>({from,to:'X'}))).text,'X ಕರ್ನಾಟಕ');
});
test('Snippets require opt-in and preserve dollar signs and line breaks',()=>{const snippets=[{id:'a',trigger:'insert sig',text:'Cost $5\nRegards'}];assert.equal(formatText('insert sig',defaults,[],snippets).text,'insert sig');assert.equal(formatText('insert sig',{...defaults,expandSnippets:true},[],snippets).text,'Cost $5\nRegards');});
test('History never-store and expiry policies',()=>{const entries=[{id:'new',createdAt:100000000},{id:'old',createdAt:1}];assert.deepEqual(pruneHistory(entries,0,100000001),[]);assert.deepEqual(pruneHistory(entries,1,100000001).map(e=>e.id),['new']);assert.equal(pruneHistory(entries,-1,100000001).length,2);});
test('Keywords reject line breaks and angle brackets',()=>assert.deepEqual(sanitizeKeywords(['GST',' GST ','a\nb','<bad>',123,'Ind AS']),['GST','Ind AS']));
test('Malformed backups do not overwrite data',()=>{assert.equal(validateBackup({version:2,terms:[],snippets:[],history:[],settings:{...defaults,retention:123}}),null);assert.ok(validateBackup({version:2,terms:[],snippets:[],history:[],settings:defaults}));});
const request=(opts={})=>{const body=new FormData();body.set('audio',new File(['fake test audio'],'test.webm',{type:'audio/webm'}));body.set('keywords',JSON.stringify(['GST','Ind AS']));body.set('language','en-IN');return new Request('https://flow.test/api/transcribe',{method:'POST',headers:{origin:opts.origin??'https://flow.test'},body});};
test('Cloud route denies anonymous, cross-origin and missing-key requests',async()=>{let calls=0;const fetcher=async()=>{calls++;return Response.json({text:'no'});};assert.equal((await transcribe(request(),'test',null,fetcher)).status,401);assert.equal((await transcribe(request({origin:'https://other.test'}),'test','user1',fetcher)).status,403);assert.equal((await transcribe(request(),undefined,'user1',fetcher)).status,503);assert.equal(calls,0);});
test('Cloud contract fixes model, passes hints, and keeps keys server-side',async()=>{const response=await transcribe(request(),'server-only-test-key','user2',async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(init.headers.Authorization,'Bearer server-only-test-key');assert.equal(init.body.get('model'),'gpt-transcribe');assert.deepEqual(init.body.getAll('languages[]'),['en']);assert.equal(init.body.get('language'),null);assert.deepEqual(init.body.getAll('keywords[]'),['GST','Ind AS']);return Response.json({text:'Test only.'});});assert.equal(response.status,200);assert.equal((await response.json()).text,'Test only.');assert.equal(response.headers.get('cache-control'),'no-store');});
test('Upstream errors never echo private provider responses',async()=>{const r=await transcribe(request(),'test','user3',async()=>new Response('secret provider details',{status:401}));assert.equal(r.status,502);assert.ok(!(await r.text()).includes('secret provider details'));});
test('Unsupported upload format rejected before provider call',async()=>{const body=new FormData();body.set('audio',new File(['test'],'test.exe'));let called=false;const r=await transcribe(new Request('https://flow.test/api/transcribe',{method:'POST',headers:{origin:'https://flow.test'},body}),'test','user4',async()=>{called=true;return Response.json({text:'bad'});});assert.equal(r.status,400);assert.equal(called,false);});
