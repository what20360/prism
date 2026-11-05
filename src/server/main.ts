import {createInterface} from 'node:readline'
import {startPrismServer} from './server'
import {localAddresses} from './discovery'
import {loadServerConfig} from './config'
import {createLogger} from './logger'
if(process.argv.includes('--help')){console.log('PRISM服务器：node dist-server/server.mjs [--config prism-server.config.json]\n配置优先级：环境变量 > JSON配置 > 默认值。运行后输入help查看本机终端命令。');process.exit(0)}
try {
 const config=await loadServerConfig(process.argv.slice(2)),logger=await createLogger({directory:config.log.directory,level:config.log.level,maxBytes:config.log.maxBytes,keep:config.log.keep})
 const server=await startPrismServer({...config,logger})
 console.log(`PRISM ${server.info().version} · http://localhost:${server.port}`)
 for(const address of localAddresses(server.port))console.log(`局域网入口：${address}`)
 if(server.info().createPolicy==='key')console.log(`建房授权码（仅终端显示，不写入日志）：${server.creationKey}`)
 console.log(`数据目录：${config.dataDir}\n日志目录：${config.log.directory}\n自动存档：${config.autoSaveMode}${config.autoSaveMode==='interval'?' / '+config.autoSaveSeconds+'秒':''}\n输入help查询或管理服务器，Ctrl+C保存退出。`)
 const terminal=createInterface({input:process.stdin,output:process.stdout,terminal:Boolean(process.stdin.isTTY)})
 if(process.stdin.isTTY){terminal.setPrompt('prism> ');terminal.prompt()}
 let stopping=false,commands=Promise.resolve()
 const stop=async()=>{if(stopping)return;stopping=true;terminal.close();await server.close();await logger.close();process.exit(0)}
 terminal.on('SIGINT',()=>{void stop().catch(error=>{console.error('退出保存失败：',error);process.exitCode=1})})
 terminal.on('line',line=>{commands=commands.then(async()=>{if(stopping||!line.trim())return;try{const result=await server.admin(line);console.log(result.text);if(result.quit){await stop();return}}catch(error){const message=error instanceof Error?error.message:'操作失败';console.error(message);logger.write('warn','console.failed',{message})};if(process.stdin.isTTY)terminal.prompt()})})
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void stop().catch(error=>{console.error('退出保存失败：',error);process.exitCode=1})})
 process.on('unhandledRejection',error=>{logger.write('error','process.unhandled_rejection',{error})})
} catch(error){console.error('PRISM启动失败：',error instanceof Error?error.message:error);process.exitCode=1}
