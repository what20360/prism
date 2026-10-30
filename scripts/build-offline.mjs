import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const result = await build({
  root,
  configFile: false,
  mode: 'production',
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  build: {
    target: 'es2022', write: false, sourcemap: false, minify: 'esbuild',
    cssCodeSplit: false, modulePreload: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    lib: { entry: resolve(root, 'src/app/main.ts'), name: 'PRISM', formats: ['iife'], fileName: () => 'prism.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
const outputs = (Array.isArray(result) ? result : [result]).flatMap((bundle) => bundle.output)
const chunks = outputs.filter((item) => item.type === 'chunk')
const styles = outputs.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.length || outputs.length !== chunks.length + styles.length) {
  throw new Error('Standalone export must contain one script and only inline styles')
}
const code = chunks[0].code
new Script(code, { filename: 'prism-offline.js' })
const css = styles.map((asset) => typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source)).join('\n')
for (const match of css.matchAll(/url\(\s*['"]?([^)'"\s]+)/g)) {
  if (!match[1].startsWith('data:') && !match[1].startsWith('#')) throw new Error('Offline CSS contains an external asset')
}
const sourcePath = resolve(root, '.openai/source.json')
const source = existsSync(sourcePath) ? JSON.parse(await readFile(sourcePath, 'utf8')) : undefined
const revision = source?.commit_sha ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid source revision')
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"><meta name="prism-source" content="${revision}"><title>PRISM</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><canvas id="game"></canvas><noscript>请启用 JavaScript 以运行 PRISM。</noscript><script>${code.replace(/<\/script/gi, '<\\/script')}</script></body></html>
`
const destination = resolve(root, 'dist-offline/PRISM_offline.html')
await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, html, 'utf8')
console.log(`${destination} (${Buffer.byteLength(html)} bytes)`)
