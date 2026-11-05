export const CONSOLE_HELP=`本机终端命令（房间ID可用rooms查看；玩家ID支持唯一前缀）：
 help                          显示帮助
 status                        在线人数、房间与网络统计
 rooms                         房间列表、阶段与倒计时
 room <房间ID>                 房间详情与成员
 players [房间ID]              玩家与角色状态
 input <玩家ID>                输入计数、序号、距上次接收时间、方向和开火状态
 start <房间ID>                发起5秒倒计时；暂停中的合作对局继续
 cancel <房间ID>               取消开局倒计时
 pause <房间ID>                暂停正式合作对局
 restart <房间ID>              重开并返回等待大厅
 kick <房间ID> <玩家ID>        移出房间
 ban <房间ID> <玩家ID>         封禁并移出
 unban <房间ID> <玩家ID>       解除此房间封禁
 transfer <房间ID> <玩家ID>    转让房主
 close <房间ID>                关闭房间
 save                          保存合作进度
 log <debug|info|warn|error>    调整日志级别（本次运行）
 stop / quit                   保存后正常退出`
export type ConsoleCommand={name:'help'|'status'|'rooms'|'save'|'stop'}|{name:'room'|'start'|'cancel'|'pause'|'restart'|'close';roomId:string}|{name:'players';roomId?:string}|{name:'input';userId:string}|{name:'kick'|'ban'|'unban'|'transfer';roomId:string;userId:string}|{name:'log';level:string}
export function parseConsoleCommand(line:string):ConsoleCommand {
 const [raw,...args]=line.trim().split(/\s+/),name=raw?.toLowerCase()
 if(!name||name==='help'||name==='?'){if(args.length)throw new Error('help不接受参数');return {name:'help'}}
 if(['status','rooms','save','stop','quit'].includes(name)&&!args.length)return {name:(name==='quit'?'stop':name) as 'status'}
 if(['room','start','cancel','pause','restart','close'].includes(name)&&args.length===1)return {name:name as 'room',roomId:args[0]!.toUpperCase()}
 if(name==='players'&&args.length<=1)return {name,roomId:args[0]?.toUpperCase()}
 if(name==='input'&&args.length===1)return {name,userId:args[0]!}
 if(['kick','ban','unban','transfer'].includes(name)&&args.length===2)return {name:name as 'kick',roomId:args[0]!.toUpperCase(),userId:args[1]!}
 if(name==='log'&&args.length===1)return {name,level:args[0]!}
 throw new Error('未知命令或参数数量错误，输入help查看帮助')
}
