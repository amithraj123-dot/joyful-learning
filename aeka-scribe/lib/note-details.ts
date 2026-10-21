export type ContextFile={id:string;name:string;text:string;at:number};
export type ActionItem={id:string;text:string;owner:string;due:string;done:boolean;segmentId:string};
export type NoteDetails={attendees:string[];folders:string[];tags:string[];eventStart:string;eventEnd:string;eventUrl:string;templateId:string;brief:string;followUp:string;starred:boolean;trashedAt:number;context:ContextFile[];highlights:string[];actions:ActionItem[];versions:{id:string;at:number;summary:string}[]};
export const emptyDetails=():NoteDetails=>({attendees:[],folders:[],tags:[],eventStart:'',eventEnd:'',eventUrl:'',templateId:'auto',brief:'',followUp:'',starred:false,trashedAt:0,context:[],highlights:[],actions:[],versions:[]});
export function validDetails(value:unknown):NoteDetails{
 const v={...emptyDetails(),...(value as object)} as NoteDetails;
 const str=(x:unknown,max:number)=>typeof x==='string'&&x.length<=max;
 const list=(x:unknown,count:number,max:number)=>Array.isArray(x)&&x.length<=count&&x.every(s=>str(s,max))&&new Set(x).size===x.length;
 if(!list(v.attendees,250,254)||!list(v.folders,12,100)||!list(v.tags,30,60)||!list(v.highlights,200,120))throw Error('Too many or invalid people, folders, tags or highlights.');
 if(!str(v.eventStart,80)||!str(v.eventEnd,80)||!str(v.eventUrl,2000)||!str(v.templateId,100)||!str(v.brief,30000)||!str(v.followUp,30000)||typeof v.starred!=='boolean'||!Number.isFinite(v.trashedAt)||v.trashedAt<0)throw Error('Invalid meeting details.');
 if(!Array.isArray(v.context)||v.context.length>10||!v.context.every(c=>c&&str(c.id,100)&&str(c.name,200)&&str(c.text,30000)&&Number.isFinite(c.at))||v.context.reduce((n,c)=>n+c.text.length,0)>100000)throw Error('Attach up to 10 text documents, 30,000 characters each and 100,000 in total.');
 if(!Array.isArray(v.actions)||v.actions.length>200||!v.actions.every(a=>a&&str(a.id,100)&&str(a.text,2000)&&str(a.owner,254)&&str(a.due,10)&&(!a.due||/^\d{4}-\d{2}-\d{2}$/.test(a.due))&&typeof a.done==='boolean'&&str(a.segmentId,120)))throw Error('Invalid action items.');
 if(!Array.isArray(v.versions)||v.versions.length>8||!v.versions.every(r=>r&&str(r.id,100)&&str(r.summary,100000)&&Number.isFinite(r.at)))throw Error('Invalid note revisions.');
 if(new Set(v.context.map(x=>x.id)).size!==v.context.length||new Set(v.actions.map(x=>x.id)).size!==v.actions.length)throw Error('Duplicate item identity.');
 return {attendees:[...v.attendees],folders:[...v.folders],tags:[...v.tags],eventStart:v.eventStart,eventEnd:v.eventEnd,eventUrl:v.eventUrl,templateId:v.templateId,brief:v.brief,followUp:v.followUp,starred:v.starred,trashedAt:v.trashedAt,context:v.context.map(({id,name,text,at})=>({id,name,text,at})),highlights:[...v.highlights],actions:v.actions.map(({id,text,owner,due,done,segmentId})=>({id,text,owner,due,done,segmentId})),versions:v.versions.map(({id,at,summary})=>({id,at,summary}))};
}
export const noteDetails=(note:{details?:NoteDetails})=>({...emptyDetails(),...note.details});
export const isTrashed=(note:{details?:NoteDetails})=>!!note.details?.trashedAt;
export const noteFolders=(note:{folder:string;details?:NoteDetails})=>[...new Set([note.folder,...(note.details?.folders||[])].filter(Boolean))];
export const inFolder=(note:{folder:string;details?:NoteDetails},folder:string)=>noteFolders(note).some(f=>f===folder||f.startsWith(folder+'/'));
