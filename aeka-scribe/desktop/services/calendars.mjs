import http from 'node:http';
import crypto from 'node:crypto';
import {findMeetingURL} from '../generated/workspace-core.mjs';

const providers={
 google:{auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scope:'openid email https://www.googleapis.com/auth/calendar.events.readonly'},
 microsoft:{auth:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',token:'https://login.microsoftonline.com/common/oauth2/v2.0/token',scope:'openid email offline_access User.Read Calendars.Read'},
};
export const optionalScopes={google:{mailSend:'https://www.googleapis.com/auth/gmail.send',mailRead:'https://www.googleapis.com/auth/gmail.readonly',calendarWrite:'https://www.googleapis.com/auth/calendar.events'},microsoft:{mailSend:'Mail.Send',mailRead:'Mail.Read',calendarWrite:'Calendars.ReadWrite'}};
const features=value=>{if(value===undefined)return [];if(!Array.isArray(value)||value.length>3||!value.every(x=>['mailSend','mailRead','calendarWrite'].includes(x)))throw Error('Invalid optional permissions.');return [...new Set(value)];};
const scopesFor=(provider,config)=>providers[provider].scope+' '+features(config.features).map(x=>optionalScopes[provider][x]).join(' ');
const granted=(provider,c,key)=>(c.scope||'').split(' ').some(s=>s.toLowerCase()===optionalScopes[provider][key].toLowerCase()||s.toLowerCase()==='https://graph.microsoft.com/'+optionalScopes[provider][key].toLowerCase());
export function pkce(){const verifier=crypto.randomBytes(48).toString('base64url');return {verifier,challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),state:crypto.randomBytes(32).toString('base64url')};}
export function calendarEvents(provider,items){
 return items.filter(e=>!e.isCancelled&&e.status!=='cancelled').map(e=>{
  const google=provider==='google';
  const time=v=>{if(!v)return '';if(v.date)return v.date+'T00:00:00';let s=v.dateTime||'';if(s&&v.timeZone==='UTC'&&!/[zZ]|[+-]\d{2}:\d{2}$/.test(s))s+='Z';return s;};
  const attendees=(e.attendees||[]).map(a=>a.email||a.emailAddress?.address||'').filter(Boolean).slice(0,100);
  return {id:provider+'_'+e.id,provider,title:(google?e.summary:e.subject)||'Untitled meeting',start:time(e.start),end:time(e.end),url:findMeetingURL(e.hangoutLink,e.onlineMeeting?.joinUrl,...(e.conferenceData?.entryPoints||[]).map(x=>x.uri),e.location?.displayName,typeof e.location==='string'?e.location:'',e.description,e.body?.content),attendees};
 }).filter(e=>e.id.length<500&&Number.isFinite(Date.parse(e.start))).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
}
export function createCalendars({vault,openExternal,fetcher=fetch}){
 const running=new Map();let mutating=Promise.resolve();
 const update=fn=>{const p=mutating.then(async()=>{const all=await vault.read('calendars',{});const result=await fn(all);await vault.write('calendars',all);return result;});mutating=p.catch(()=>{});return p;};
 const status=async()=>{const all=await vault.read('calendars',{});return Object.keys(providers).map(provider=>({provider,connected:!!all[provider]?.access_token,clientId:all[provider]?.clientId||'',email:all[provider]?.email||'',hasClientSecret:!!all[provider]?.clientSecret,features:all[provider]?.features||[],permissions:Object.keys(optionalScopes[provider]).filter(k=>granted(provider,all[provider]||{},k)),connectionId:all[provider]?.connectionId||''}));};
 const saveConfig=async({provider,clientId,clientSecret,features:requested})=>{
  if(!providers[provider]||typeof clientId!=='string'||clientId.length>300||!clientId.trim())throw Error('Enter a valid desktop OAuth client ID.');
  if(clientSecret!==undefined&&(typeof clientSecret!=='string'||clientSecret.length>500))throw Error('Invalid client secret.');
  if(requested!==undefined)features(requested);running.get(provider)?.();
  await update(all=>{const old=all[provider]||{},chosen=requested===undefined?features(old.features):features(requested),sameClient=old.clientId===clientId.trim(),changed=!sameClient||JSON.stringify(old.features||[])!==JSON.stringify(chosen)||(clientSecret!==undefined&&clientSecret!==old.clientSecret);
   all[provider]={...(changed?{}:old),clientId:clientId.trim(),clientSecret:clientSecret!==undefined?clientSecret:sameClient?old.clientSecret||'':'',features:chosen,generation:crypto.randomUUID()};});return status();
 };

 const requestToken=async(provider,params)=>{const r=await fetcher(providers[provider].token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Calendar sign-in failed. Check the desktop client registration and reconnect.');const t=await r.json();if(typeof t.access_token!=='string')throw Error('Calendar provider returned no access token.');return {...t,expiresAt:Date.now()+(Number(t.expires_in)||3600)*1000};};
 const connect=async(provider)=>{
  if(!providers[provider])throw Error('Unknown calendar provider.');if(running.has(provider))throw Error('Sign-in is already open. Finish it or wait for it to expire.');
  const config=(await vault.read('calendars',{}))[provider];if(!config?.clientId)throw Error('Save a desktop OAuth client ID first.');
  const {verifier,challenge,state}=pkce();let timer,server,finished=false,exchanging=false;
  return new Promise((resolve,reject)=>{
   const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);server?.close();server?.closeAllConnections();running.delete(provider);error?reject(error):resolve(value);};
   server=http.createServer(async(req,res)=>{
    let u;try{u=new URL(req.url,'http://127.0.0.1');}catch{res.writeHead(400).end();return;}
    if(req.method!=='GET'||u.pathname!=='/callback'){res.writeHead(404).end();return;}
    if(u.searchParams.get('state')!==state){res.writeHead(400).end('Sign-in state did not match.');return;}
    res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');
    if(u.searchParams.has('error')){res.end('Calendar sign-in was cancelled. Return to Flow.');finish(Error('Calendar sign-in was cancelled.'));return;}
    const code=u.searchParams.get('code');if(!code){res.writeHead(400).end('No authorization code.');return;}
    if(exchanging){res.writeHead(409).end('Sign-in is already being completed.');return;}exchanging=true;
    res.end('Sign-in received. You can close this tab and return to Flow.');
    try{const redirect='http://'+(provider==='google'?'127.0.0.1':'localhost')+':'+server.address().port+'/callback';const t=await requestToken(provider,{grant_type:'authorization_code',client_id:config.clientId,...(config.clientSecret?{client_secret:config.clientSecret}:{}),code,code_verifier:verifier,redirect_uri:redirect});let email='';
     const profile=await fetcher(provider==='google'?'https://openidconnect.googleapis.com/v1/userinfo':'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',{headers:{Authorization:'Bearer '+t.access_token},signal:AbortSignal.timeout(15000)});if(profile.ok){const p=await profile.json();email=p.email||p.mail||p.userPrincipalName||'';}
     await update(all=>{if(finished||all[provider]?.generation!==config.generation)throw Error('Calendar sign-in cancelled because the connection changed.');all[provider]={...config,...t,scope:t.scope||scopesFor(provider,config),email,connectionId:crypto.randomUUID()};});finish(null,await status());
    }catch(e){finish(e);}
   });
   server.on('error',()=>finish(Error('Could not open the local calendar sign-in callback.')));
   server.listen(0,'127.0.0.1',async()=>{const u=new URL(providers[provider].auth);Object.entries({client_id:config.clientId,response_type:'code',redirect_uri:'http://'+(provider==='google'?'127.0.0.1':'localhost')+':'+server.address().port+'/callback',scope:scopesFor(provider,config),state,code_challenge:challenge,code_challenge_method:'S256',...(provider==='google'?{access_type:'offline',prompt:'consent'}:{prompt:'select_account'})}).forEach(([k,v])=>u.searchParams.set(k,v));try{await openExternal(u.href);}catch{finish(Error('Could not open your browser for sign-in.'));}});
   running.set(provider,()=>finish(Error('Calendar sign-in cancelled.')));timer=setTimeout(()=>finish(Error('Calendar sign-in timed out. Try again.')),180000);
  });
 };
 const token=async(provider)=>{let c=(await vault.read('calendars',{}))[provider];if(!c?.access_token)throw Error('Connect this calendar first.');if(c.expiresAt<Date.now()+60000){if(!c.refresh_token)throw Error('Calendar access expired. Reconnect this account.');const t=await requestToken(provider,{grant_type:'refresh_token',client_id:c.clientId,...(c.clientSecret?{client_secret:c.clientSecret}:{}),refresh_token:c.refresh_token,...(provider==='microsoft'?{scope:scopesFor(provider,c)}:{})});const generation=c.generation,connectionId=c.connectionId;c={...c,...t};await update(all=>{if(all[provider]?.generation!==generation||all[provider]?.connectionId!==connectionId||!all[provider]?.access_token)throw Error('Calendar connection changed. Reconnect.');all[provider]=c;});}return c.access_token;};
 const events=async()=>{const states=await status(),events=[],errors=[];await Promise.all(states.filter(s=>s.connected).map(async s=>{try{const access=await token(s.provider),start=new Date(Date.now()-3600000).toISOString(),end=new Date(Date.now()+14*86400000).toISOString();let u;
   if(s.provider==='google'){u=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');u.search=new URLSearchParams({timeMin:start,timeMax:end,singleEvents:'true',orderBy:'startTime',maxResults:'250'}).toString();}
   else{u=new URL('https://graph.microsoft.com/v1.0/me/calendarView');u.search=new URLSearchParams({startDateTime:start,endDateTime:end,'$top':'250','$select':'id,subject,start,end,onlineMeeting,location,attendees,isCancelled,body'}).toString();}
   const r=await fetcher(u,{headers:{Authorization:'Bearer '+access,Prefer:'outlook.timezone="UTC"'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Calendar could not refresh. Reconnect if access has expired.');const d=await r.json();events.push(...calendarEvents(s.provider,d.items||d.value||[]));
  }catch(e){errors.push({provider:s.provider,message:e.message});}}));return {events:events.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)),errors,refreshedAt:Date.now()};};
 return {status,saveConfig,connect,events,access:async(provider,capability)=>{if(!optionalScopes[provider]?.[capability])throw Error('Unknown permission.');const c=(await vault.read('calendars',{}))[provider];if(!c?.access_token||!granted(provider,c,capability))throw Error('Enable the required permission and reconnect this account in Desktop settings.');const accessToken=await token(provider),current=(await vault.read('calendars',{}))[provider];if(current?.connectionId!==c.connectionId)throw Error('Account changed. Prepare a new review.');if(!current.email)throw Error('Reconnect to verify this account’s email address.');return {token:accessToken,email:current.email,connectionId:current.connectionId||current.email};},disconnect:async provider=>{if(!providers[provider])throw Error('Unknown calendar.');running.get(provider)?.();await update(all=>{const c=all[provider];all[provider]={clientId:c?.clientId||'',clientSecret:c?.clientSecret||'',features:c?.features||[],generation:crypto.randomUUID()};});return status();},close:()=>{for(const cancel of running.values())cancel();}};
}
