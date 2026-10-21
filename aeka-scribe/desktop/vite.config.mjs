import {defineConfig} from '../node_modules/vite/dist/node/index.js';
import react from '../node_modules/@vitejs/plugin-react/dist/index.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:path.join(dir,'ui'),base:'./',plugins:[react()],publicDir:path.join(dir,'assets'),resolve:{alias:{'@':path.dirname(dir)}},build:{outDir:path.join(dir,'ui-dist'),emptyOutDir:true,rollupOptions:{input:path.join(dir,'ui','index.html')}},server:{fs:{allow:[path.dirname(dir)]}}});
