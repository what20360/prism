import { zipSync } from 'fflate'
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const files={}
async function include(directory){for(const item of await readdir(directory,{withFileTypes:true})){if(directory==='dist'&&item.name==='server')continue;const path=join(directory,item.name);if(item.isDirectory())await include(path);else files['PRISM_server/'+path.replaceAll('\\','/')]=new Uint8Array(await readFile(path))}}
await include('dist');await include('dist-server')
for(const name of ['package.json','package-lock.json','start-server.cmd','start-server.sh'])files['PRISM_server/'+name]=new Uint8Array(await readFile(name))
files['PRISM_server/README.md']=new Uint8Array(await readFile('docs/server-guide.md'))
await mkdir('dist/server',{recursive:true});await writeFile('dist/server/PRISM_server.zip',zipSync(files,{level:6}))
console.log('Packaged dist/server/PRISM_server.zip (no runtime data or credentials)')
