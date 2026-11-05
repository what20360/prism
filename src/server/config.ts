import {readFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import type {AutoSaveMode} from '../storage/config'
import {LOG_LEVELS,type LogLevel} from './logger'
export interface RuntimeConfig {autoSaveMode:AutoSaveMode;autoSaveSeconds:number;port:number;host:string;dataDir:string;name:string;createPolicy:'key'|'open';createKey?:string;publicUrl?:string;allowedOrigins:string[];discovery:boolean;maxRooms:number;maxConnections:number;roomTtlMs:number;staticDir:string;log:{directory:string;level:LogLevel;maxBytes:number;keep:number};configPath:string}
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('配置必须为JSON对象');return v as Record<string,unknown>}
const text=(v:unknown,key:string,max=2000)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f]/.test(v))throw new Error(key+'必须为非空文本');return v.trim()}
const number=(v:unknown,key:string,min:number,max:number)=>{if(typeof v!=='number'||!Number.isFinite(v)||!Number.isInteger(v)||v<min||v>max)throw new Error(`${key}必须为${min}–${max}的整数`);return v}
function origin(v:unknown,key:string){const s=text(v,key),u=new URL(s);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error(key+'必须为HTTP(S)根地址');return u.origin}
export async function loadServerConfig(args:string[]=[],env:NodeJS.ProcessEnv=process.env,cwd=process.cwd()):Promise<RuntimeConfig>{
 let chosen=env.PRISM_CONFIG,explicit=Boolean(chosen)
 for(let i=0;i<args.length;i++){if(args[i]!=='--config'||!args[i+1]||chosen)throw new Error('用法：node dist-server/server.mjs [--config 配置文件]');chosen=args[++i];explicit=true}
 const configPath=resolve(cwd,chosen??'prism-server.config.json');let file:Record<string,unknown>={}
 try{const raw=await readFile(configPath,'utf8');if(Buffer.byteLength(raw)>65536)throw new Error('配置文件超过64KiB');file=object(JSON.parse(raw))}catch(e){if(explicit||(e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
 const allowed=['version','port','host','dataDir','name','createPolicy','createKey','publicUrl','allowedOrigins','discovery','maxRooms','maxConnections','roomTtlDays','staticDir','log','autoSave']
 for(const k of Object.keys(file))if(!allowed.includes(k))throw new Error('未知配置项：'+k)
 if(file.version!==undefined&&file.version!==1)throw new Error('配置version必须为1')
 const value=(key:string,envKey:string,fallback:unknown)=>env[envKey]??file[key]??fallback
 const numeric=(key:string,envKey:string,fallback:number,min:number,max:number)=>{const raw=env[envKey],v=raw===undefined?file[key]??fallback:raw.trim()?Number(raw):raw;return number(v,key,min,max)}
 const base=dirname(configPath),dataDir=resolve(base,text(value('dataDir','PRISM_DATA_DIR','.prism-server'),'dataDir'))
 const publicRaw=value('publicUrl','PRISM_PUBLIC_URL',undefined),publicUrl=publicRaw===undefined?undefined:origin(publicRaw,'publicUrl')
 const policy=value('createPolicy','PRISM_CREATE_POLICY','key');if(policy!=='key'&&policy!=='open')throw new Error('createPolicy必须为key或open')
 const discover=value('discovery','PRISM_DISCOVERY','auto');if(!['auto','on','off',true,false].includes(discover as string))throw new Error('discovery必须为auto/on/off或布尔值')
 const rawOrigins=value('allowedOrigins','PRISM_ALLOWED_ORIGINS',['https://what20360.github.io']),list=typeof rawOrigins==='string'?rawOrigins.split(','):rawOrigins
 if(!Array.isArray(list)||list.length>20)throw new Error('allowedOrigins必须为最多20项的来源列表')
 const log=file.log===undefined?{}:object(file.log);for(const k of Object.keys(log))if(!['directory','level','maxFileMiB','keep'].includes(k))throw new Error('未知日志配置：'+k)
 const logLevel=env.PRISM_LOG_LEVEL??log.level??'info';if(!LOG_LEVELS.includes(logLevel as LogLevel))throw new Error('log.level必须为debug/info/warn/error')
 const save=file.autoSave===undefined?{}:object(file.autoSave);for(const k of Object.keys(save))if(!['mode','seconds'].includes(k))throw new Error('未知自动存档配置：'+k)
 const autoMode=env.PRISM_AUTOSAVE??save.mode??'room';if(!['room','interval','off'].includes(String(autoMode)))throw new Error('autoSave.mode必须为room/interval/off')
 const autoSeconds=number(env.PRISM_AUTOSAVE_SECONDS===undefined?save.seconds??60:Number(env.PRISM_AUTOSAVE_SECONDS),'autoSave.seconds',5,3600)
 const key=value('createKey','PRISM_CREATE_KEY',undefined)
 return {autoSaveMode:autoMode as AutoSaveMode,autoSaveSeconds:autoSeconds,configPath,port:numeric('port','PRISM_PORT',8787,1,65535),host:text(value('host','PRISM_HOST','0.0.0.0'),'host',255),dataDir,name:text(value('name','PRISM_SERVER_NAME','PRISM 私人服务器'),'name',60),createPolicy:policy,createKey:key===undefined?undefined:text(key,'createKey',128),publicUrl,allowedOrigins:list.map(s=>origin(s,'allowedOrigins')),discovery:discover==='auto'?!publicUrl:discover===true||discover==='on',maxRooms:numeric('maxRooms','PRISM_MAX_ROOMS',8,1,100),maxConnections:numeric('maxConnections','PRISM_MAX_CONNECTIONS',32,1,500),roomTtlMs:numeric('roomTtlDays','PRISM_ROOM_TTL_DAYS',7,1,365)*86400000,staticDir:resolve(base,text(value('staticDir','PRISM_STATIC_DIR','dist'),'staticDir')),log:{directory:resolve(dataDir,text(env.PRISM_LOG_DIR??log.directory??'logs','log.directory')),level:logLevel as LogLevel,maxBytes:number(log.maxFileMiB??5,'log.maxFileMiB',1,100)*1024*1024,keep:number(log.keep??5,'log.keep',1,20)}}
}
