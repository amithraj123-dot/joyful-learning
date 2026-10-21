import ts from '../node_modules/typescript/lib/typescript.js';
import fs from 'node:fs/promises';
const dest=new URL('./generated/',import.meta.url);await fs.mkdir(dest,{recursive:true});
for(const name of ['workspace-core','flow-core','ai-workspace','note-details','meeting-studio','image-context']){const source=await fs.readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll(/from '(\.\/[^']+)\.ts'/g,"from '$1.mjs'");await fs.writeFile(new URL(name+'.mjs',dest),output);}

await fs.copyFile(new URL('../public/pdf.worker.min.mjs',import.meta.url),new URL('./assets/pdf.worker.min.mjs',import.meta.url));
await fs.copyFile(new URL('../public/pdfjs-LICENSE.txt',import.meta.url),new URL('./assets/pdfjs-LICENSE.txt',import.meta.url));
