import { randomBytes, randomUUID, createHash, timingSafeEqual, scryptSync, scrypt } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
export interface Identity { id:string; name:string; hash:string; created:number }
export interface Database { version:1; serverId:string; createKey:string; users:Identity[]; rooms:unknown[] }
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex')
export function equalSecret(a:string,b:string):boolean {const x=Buffer.from(tokenHash(a)),y=Buffer.from(tokenHash(b));return timingSafeEqual(x,y)}
export function passwordHash(password:string,salt=randomBytes(16).toString('hex')):string {return salt+':'+scryptSync(password,salt,32).toString('hex')}
export async function passwordHashAsync(password:string,salt=randomBytes(16).toString('hex')):Promise<string> {const bytes=await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,32,(error,key)=>error?reject(error):resolve(key)));return salt+':'+bytes.toString('hex')}
export async function passwordMatchesAsync(password:string,stored:string):Promise<boolean> {return equalSecret(await passwordHashAsync(password,stored.split(':')[0]!),stored)}
export function passwordMatches(value:string,stored:string):boolean {const salt=stored.split(':')[0]!;return equalSecret(passwordHash(value,salt),stored)}
export async function openStore(directory:string) {
 await mkdir(directory,{recursive:true,mode:0o700})
 const path=join(directory,'server.json');let data:Database
 try {const text=await readFile(path,'utf8');if(Buffer.byteLength(text)>32*1024*1024)throw new Error('服务器存档超过32MiB');data=JSON.parse(text) as Database;if(data.version!==1||typeof data.serverId!=='string'||typeof data.createKey!=='string'||!Array.isArray(data.users)||data.users.length>10000||!Array.isArray(data.rooms))throw new Error('服务器身份数据库无效')}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;data={version:1,serverId:randomUUID(),createKey:randomBytes(24).toString('base64url'),users:[],rooms:[]}}
 let pending=Promise.resolve()
 const save=()=>{const text=JSON.stringify(data);pending=pending.catch(()=>{}).then(async()=>{const temp=path+'.tmp';await writeFile(temp,text,{mode:0o600});await rename(temp,path)});return pending}
 const identify=(name:string,id?:string,token?:string)=>{
  if(id||token){const user=data.users.find(u=>u.id===id);if(!user||!token||!equalSecret(user.hash,tokenHash(token)))throw new Error('身份凭证无效；请恢复身份备份或使用新身份连接');user.name=name;return {user}}
  if(data.users.length>=10000)throw new Error('服务器身份容量已满')
  const nextToken=randomBytes(32).toString('base64url'),user={id:'P-'+randomUUID(),name,hash:tokenHash(nextToken),created:Date.now()};data.users.push(user);return {user,token:nextToken}
 }
 return {data,save,identify}
}
