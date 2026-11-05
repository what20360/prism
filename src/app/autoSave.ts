import type { AutoSaveMode } from '../storage/config'
/** Policy only: a failed write must never advance the successful-save checkpoint. */
export function createAutoSaveSchedule(){
 let lastKey:string|undefined,lastAt=0
 return {due:(key:string|null,mode:AutoSaveMode,seconds:number,now:number)=>Boolean(key)&&mode!=='off'&&(key!==lastKey||mode==='interval'&&now-lastAt>=seconds*1000),saved:(key:string,now:number)=>{lastKey=key;lastAt=now}}
}
