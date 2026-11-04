import { resolve } from 'node:path'
import { startPrismServer } from './server'
import { localAddresses } from './discovery'
const port=Number(process.env.PRISM_PORT??8787)
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PRISM_PORT必须为1–65535')
const server=await startPrismServer({port,host:process.env.PRISM_HOST??'0.0.0.0',dataDir:resolve(process.env.PRISM_DATA_DIR??'.prism-server'),name:process.env.PRISM_SERVER_NAME??'PRISM 私人服务器',createPolicy:process.env.PRISM_CREATE_POLICY==='open'?'open':'key',createKey:process.env.PRISM_CREATE_KEY,publicUrl:process.env.PRISM_PUBLIC_URL,allowedOrigins:process.env.PRISM_ALLOWED_ORIGINS?.split(',').map(s=>s.trim()),staticDir:resolve('dist'),discovery:process.env.PRISM_DISCOVERY==='on'||!process.env.PRISM_PUBLIC_URL&&process.env.PRISM_DISCOVERY!=='off'})
console.log(`PRISM ${server.info().version} · http://localhost:${server.port}`)
for(const address of localAddresses(server.port))console.log(`局域网入口：${address}`)
if(server.info().createPolicy==='key')console.log(`建房授权码（仅分享给获准建房的朋友）：${server.creationKey}`)
console.log('玩家打开游戏的「服务器与局域网」入口连接。Ctrl+C安全保存并退出。')
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void server.close().then(()=>process.exit(0))})
