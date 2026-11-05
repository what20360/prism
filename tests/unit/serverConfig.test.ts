import {describe,it,expect,afterEach} from 'vitest'
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {loadServerConfig} from '../../src/server/config'
import {createLogger} from '../../src/server/logger'
import {parseConsoleCommand} from '../../src/server/console'
const cleanup:(()=>Promise<unknown>)[]=[]
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f()})
async function directory(){const dir=await mkdtemp(join(tmpdir(),'prism-config-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));return dir}
describe('server configuration and operational logs',()=>{
 it('uses defaults, then file values, then environment overrides, resolving paths beside the config',async()=>{
  const dir=await directory(),defaults=await loadServerConfig([],{},dir);expect(defaults.port).toBe(8787);expect(defaults.discovery).toBe(true)
  await writeFile(join(dir,'prism-server.config.json'),JSON.stringify({version:1,port:8888,dataDir:'data',publicUrl:'https://game.example.com',log:{level:'debug',directory:'history'}}))
  const c=await loadServerConfig([],{PRISM_PORT:'9999',PRISM_LOG_LEVEL:'warn'},dir);expect(c.port).toBe(9999);expect(c.dataDir).toBe(join(dir,'data'));expect(c.log.directory).toBe(join(dir,'data','history'));expect(c.log.level).toBe('warn');expect(c.discovery).toBe(false)
 })
 it.each([{port:0},{port:'8787'},{port:1.2},{discovery:'maybe'},{allowedOrigins:['*']},{allowedOrigins:['https://user:pass@example.com']},{log:{level:'verbose'}},{log:{keep:0}},{log:{typo:3}},{version:2},{unknown:true}])('rejects invalid configuration %j',async data=>{
  const dir=await directory();await writeFile(join(dir,'bad.json'),JSON.stringify(data));await expect(loadServerConfig(['--config','bad.json'],{},dir)).rejects.toThrow()
 })
 it('reports missing explicit files, invalid JSON, invalid environment values and command arguments',async()=>{
  const dir=await directory();await expect(loadServerConfig(['--config','missing.json'],{},dir)).rejects.toThrow();await writeFile(join(dir,'broken.json'),'{');await expect(loadServerConfig(['--config','broken.json'],{},dir)).rejects.toThrow()
  await expect(loadServerConfig([],{PRISM_PORT:'nonsense'},dir)).rejects.toThrow();await expect(loadServerConfig([],{PRISM_DISCOVERY:'maybe'},dir)).rejects.toThrow();await expect(loadServerConfig(['--mystery'],{},dir)).rejects.toThrow()
 })
 it('redacts secrets, escapes terminal controls, honors levels and protects reserved log fields',async()=>{
  const dir=await directory(),terminal:string[]=[],logger=await createLogger({directory:dir,terminal:s=>terminal.push(s)})
  logger.write('debug','hidden');logger.write('info','test',{token:'bearer-secret',password:'password-secret',key:'create-secret',nested:{credential:'private'},name:'name\x1b[31m\nspoof',event:'override',level:'error'})
  await logger.close();const text=await readFile(join(dir,'server.log'),'utf8'),row=JSON.parse(text);expect(row.event).toBe('test');expect(row.level).toBe('info');expect(row.token).toBe('[redacted]');expect(row.nested.credential).toBe('[redacted]');expect(terminal).toHaveLength(1)
  for(const secret of ['bearer-secret','password-secret','create-secret','hidden'])expect(text).not.toContain(secret);expect(terminal[0]).not.toContain('\x1b')
 })
 it('rotates bounded log files and flushes queued entries on close',async()=>{
  const dir=await directory(),logger=await createLogger({directory:dir,maxBytes:250,keep:2,terminal:()=>{}})
  for(let i=0;i<10;i++)logger.write('info','rotation',{index:i,message:'x'.repeat(50)})
  await logger.close();expect((await readdir(dir)).sort()).toEqual(['server.log','server.log.1','server.log.2']);expect(await readFile(join(dir,'server.log'),'utf8')).toContain('"index":9')
 })
 it('parses exact local console operations and rejects ambiguous or extra arguments',()=>{
  expect(parseConsoleCommand('room abc234')).toEqual({name:'room',roomId:'ABC234'});expect(parseConsoleCommand('quit')).toEqual({name:'stop'});expect(parseConsoleCommand('input P-123')).toEqual({name:'input',userId:'P-123'})
  for(const line of ['save extra','ban room','log','rm everything','start'])expect(()=>parseConsoleCommand(line)).toThrow()
 })
})
