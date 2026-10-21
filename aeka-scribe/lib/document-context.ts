// Document bytes stay in the browser. Only reviewed extracted text is saved.
import {unzipSync,strFromU8} from 'fflate';
export function docxXML(bytes:Uint8Array){
 if(bytes.length>10*1024*1024)throw Error('Choose a document under 10 MB.');
 let total=0;
 const files=unzipSync(bytes,{filter:f=>{total+=f.originalSize;if(total>30*1024*1024)throw Error('This document expands beyond the 30 MB safety limit.');return f.name==='word/document.xml'&&f.originalSize<=4*1024*1024;}});
 if(!files['word/document.xml'])throw Error('This file is not a supported Word document.');
 const xml=strFromU8(files['word/document.xml']);
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Document entity declarations are not supported.');
 return xml;
}
export function boundedContext(text:string){
 const clean=text.replace(/\u0000/g,'').trim();if(!clean)throw Error('No readable text was found. For a scan, attach page images and use image text extraction.');
 return {text:clean.slice(0,30000),truncated:clean.length>30000};
}
export async function extractDocument(file:File):Promise<{text:string;truncated:boolean}>{
 if(file.size>10*1024*1024)throw Error('Choose a document under 10 MB.');
 const ext=file.name.split('.').pop()?.toLowerCase();
 if(['txt','md','csv','json'].includes(ext||'')){if(file.size>500000)throw Error('Choose a text file under 500 KB.');return boundedContext(await file.text());}
 if(ext==='docx'){
  const document=new DOMParser().parseFromString(docxXML(new Uint8Array(await file.arrayBuffer())),'application/xml');
  if(document.querySelector('parsererror'))throw Error('The Word document could not be read.');
  const lines=Array.from(document.getElementsByTagNameNS('*','p')).map(p=>Array.from(p.getElementsByTagNameNS('*','t')).map(t=>t.textContent||'').join(''));
  return boundedContext(lines.join('\n'));
 }
 if(ext==='pdf'){
  const pdfjs=await import('pdfjs-dist');
  // Serve the pinned worker as a static asset; development transforms assume a window.
  pdfjs.GlobalWorkerOptions.workerSrc=window.location.protocol==='file:'?new URL('pdf.worker.min.mjs',document.baseURI).href:'/pdf.worker.min.mjs';
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true});
  task.onPassword=()=>{void task.destroy();};
  try{const pdf=await task.promise;let text='';const pages=Math.min(pdf.numPages,100);for(let i=1;i<=pages;i++){const page=await pdf.getPage(i),content=await page.getTextContent();text+='\n[Page '+i+']\n'+content.items.map(x=>'str' in x?x.str+(x.hasEOL?'\n':' '):'').join('');page.cleanup();if(text.length>30000)return {...boundedContext(text),truncated:true};}if(!text.replace(/\[Page \d+\]/g,'').trim())throw Error('This PDF contains no extractable text. Attach its page images to extract scanned text.');return {...boundedContext(text),truncated:pdf.numPages>pages};}finally{await task.destroy();}
 }
 throw Error('Choose PDF, DOCX, text, Markdown, CSV or JSON.');
}
export async function imageForExtraction(file:File){
 if(file.size>10*1024*1024||!/^image\/(png|jpeg|webp)$/.test(file.type))throw Error('Choose a PNG, JPEG or WebP image under 10 MB.');
 const bitmap=await createImageBitmap(file);try{if(bitmap.width*bitmap.height>50_000_000)throw Error('Choose an image under 50 megapixels.');const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image processing is unavailable.');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',0.85);if(data.length>1_500_000)throw Error('This image is too detailed. Crop it into smaller sections.');return data;}finally{bitmap.close();}
}
