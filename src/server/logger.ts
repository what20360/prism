import {mkdir,appendFile,rename,rm,stat} from 'node:fs/promises'
import {join} from 'node:path'
export const LOG_LEVELS=['debug','info','warn','error'] as const
export type LogLevel=typeof LOG_LEVELS[number]
export interface ServerLogger {write(level:LogLevel,event:string,data?:Record<string,unknown>):void;setLevel(level:LogLevel):void;getLevel():LogLevel;flush():Promise<void>;close():Promise<void>}
export const silentLogger:ServerLogger={write(){},setLevel(){},getLevel:()=> 'error',flush:async()=>{},close:async()=>{}}
const cleanText=(s:string)=>s.replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').slice(0,2000)
function redact(value:unknown,depth=0):unknown {
 if(depth>8)return '[depth limit]'
 if(typeof value==='string')return cleanText(value)
 if(value instanceof Error)return {name:value.name,message:cleanText(value.message)}
 if(Array.isArray(value))return value.slice(0,100).map(v=>redact(v,depth+1))
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([k,v])=>[k,/token|password|secret|authorization|cookie|hash|^key$|createkey|credential/i.test(k)?'[redacted]':redact(v,depth+1)]))
 return value
}
export async function createLogger(options:{directory:string;level?:LogLevel;maxBytes?:number;keep?:number;terminal?:(line:string)=>void}):Promise<ServerLogger>{
 await mkdir(options.directory,{recursive:true,mode:0o700});const path=join(options.directory,'server.log'),maxBytes=options.maxBytes??5*1024*1024,keep=options.keep??5
 let level=options.level??'info',size=await stat(path).then(s=>s.size,()=>0),queue=Promise.resolve(),pending=0,dropped=0,closed=false
 const terminal=options.terminal??(line=>console.log(line))
 const append=async(line:string)=>{const bytes=Buffer.byteLength(line);if(size&&size+bytes>maxBytes){await rm(path+'.'+keep,{force:true});for(let i=keep-1;i>=1;i--)await rename(path+'.'+i,path+'.'+(i+1)).catch(e=>{if(e.code!=='ENOENT')throw e});await rename(path,path+'.1').catch(e=>{if(e.code!=='ENOENT')throw e});size=0}await appendFile(path,line,{mode:0o600});size+=bytes}
 return {getLevel:()=>level,setLevel:value=>{if(!LOG_LEVELS.includes(value))throw new Error('日志级别无效');level=value},write:(severity,event,data={})=>{
  if(closed||LOG_LEVELS.indexOf(severity)<LOG_LEVELS.indexOf(level))return
  if(pending>=1024){dropped++;return}
  const row={...redact(data) as Record<string,unknown>,time:new Date().toISOString(),level:severity,event:cleanText(event),...(dropped?{dropped}:{} )};dropped=0
  const line=JSON.stringify(row)+'\n';terminal(`${row.time} ${severity.toUpperCase()} ${row.event} ${JSON.stringify(redact(data))}`);pending++
  queue=queue.then(()=>append(line)).catch(()=>terminal('ERROR log.write_failed 无法写入日志，请检查目录权限和磁盘空间')).finally(()=>{pending--})
 },flush:()=>queue,close:async()=>{closed=true;await queue}}
}
