import { build } from 'esbuild'
await build({entryPoints:['src/server/main.ts'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'dist-server/server.mjs',external:['ws'],sourcemap:true})
console.log('Built dist-server/server.mjs; start with npm run server')
