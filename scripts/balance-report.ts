import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs'
import {resolve,join,relative} from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {runReport,validateConfig} from '../src/analysis/budget'

const args=process.argv.slice(2)
function option(name:string,fallback:string):string {const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1]!.startsWith('--'))throw Error(name+' 需要参数');return args[i+1]!}
if(args.includes('--help')){console.log('npm run balance:report -- [--config config/balance-report.json] [--out public/balance]');process.exit(0)}
for(let i=0;i<args.length;i+=2)if(!['--config','--out'].includes(args[i]!))throw Error('未知参数 '+args[i])
const configPath=resolve(option('--config','config/balance-report.json')),out=resolve(option('--out','public/balance'))
const config=validateConfig(JSON.parse(readFileSync(configPath,'utf8')))
const root=process.cwd(),sourceFiles:string[]=[]
function scan(dir:string){for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())scan(file);else if(entry.isFile()&&/\.(ts|json)$/.test(entry.name))sourceFiles.push(file)}}
scan(resolve(root,'src'));sourceFiles.push(resolve(root,'scripts/balance-report.ts'),configPath)
const hash=createHash('sha256');for(const file of [...new Set(sourceFiles)].sort()){hash.update(relative(root,file)).update('\0').update(readFileSync(file)).update('\0')}
let commit='unknown',dirty=true
try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();dirty=!!execFileSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8'}).trim()}catch{/* Source archives may not have Git. */}
const metadata={format:'prism-budget-report-v1',commit,dirty,sourceSha256:hash.digest('hex'),configFile:relative(root,configPath),simulationHz:60,measurement:'靶机生命损失，包含护甲/格挡/抗性与持续伤害，不计溢出',scope:'无遮挡静止无护盾靶机；持续射击；目标持续存在；不使用技能或地雷',purchaseRule:'每个预算独立从零，先逐项购买 opening，再循环 cycle；遇到第一张买不起的卡即停止，不跳过、不出售；opening 未完成不绘制该构筑。'}
console.log('运行 '+config.builds.length+' 构筑 × '+config.scenarios.length+' 场景 × '+config.budgets.length+' 预算……')
const started=Date.now(),results=runReport(config)
mkdirSync(out,{recursive:true})
writeFileSync(join(out,'results.json'),JSON.stringify({metadata,config,results},null,2)+'\n')
const csv=(x:unknown)=>'"'+String(x??'').replaceAll('"','""')+'"'
const rows=[['场景','构筑','预算','已花','余额','可用','测量秒数','周期不足','总伤害','总DPS','目标平均DPS','各目标DPS','购卡顺序及价格'].map(csv).join(',')]
for(const r of results)rows.push([config.scenarios.find(s=>s.id===r.scenarioId)!.name,config.builds.find(b=>b.id===r.buildId)!.name,r.budget,r.spent,r.remaining,r.available,r.measurementSeconds,r.cycleLimited,r.damage,r.dps,r.averageTargetDps,JSON.stringify(r.perTarget??[]),r.orders.map(o=>o.name+' Lv'+o.level+'('+o.price+')').join(' → ')].map(csv).join(','))
writeFileSync(join(out,'results.csv'),'\ufeff'+rows.join('\n')+'\n')
const esc=(s:unknown)=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
const fmt=(n:number|undefined)=>n===undefined?'—':Number(n.toFixed(2)).toLocaleString('zh-CN',{maximumFractionDigits:2})
const colors=['#22d3ee','#fb923c','#c084fc','#f472b6','#a3e635','#facc15','#60a5fa','#fb7185','#2dd4bf','#f59e0b']
function chart(scenario:string,metric:'dps'|'averageTargetDps'){
 const width=900,height=400,l=72,r=28,t=25,b=62,points=results.filter(x=>x.scenarioId===scenario),budgets=[...config.budgets].sort((a,b)=>a-b),max=Math.max(1,...points.map(p=>p[metric]??0))*1.08
 const x=(v:number)=>l+(width-l-r)*(Math.log2(1+v)-Math.log2(1+budgets[0]!))/Math.max(1e-9,Math.log2(1+budgets.at(-1)!)-Math.log2(1+budgets[0]!))
 const y=(v:number)=>height-b-(height-t-b)*v/max
 const grid=Array.from({length:5},(_,i)=>{const v=max*i/4,py=y(v);return '<line x1="'+l+'" y1="'+py+'" x2="'+(width-r)+'" y2="'+py+'" stroke="#334155"/><text x="'+(l-9)+'" y="'+(py+4)+'" text-anchor="end">'+fmt(v)+'</text>'}).join('')
 const ticks=budgets.map(v=>'<text x="'+x(v)+'" y="'+(height-b+23)+'" text-anchor="middle">'+v+'</text>').join('')
 const lines=config.builds.map((build,index)=>{const p=points.filter(q=>q.buildId===build.id&&q[metric]!==undefined).sort((a,b)=>a.budget-b.budget),color=colors[index%colors.length],segments=p.map(q=>x(q.budget)+','+y(q[metric]!)).join(' ');return '<polyline points="'+segments+'" fill="none" stroke="'+color+'" stroke-width="3"/>'+p.map(q=>'<circle cx="'+x(q.budget)+'" cy="'+y(q[metric]!)+'" r="5" fill="'+color+'"><title>'+esc(build.name)+' · '+q.budget+' 棱晶：'+fmt(q[metric])+' DPS；实际花费 '+q.spent+'</title></circle>').join('')}).join('')
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(scenario)+' DPS曲线"><rect width="100%" height="100%" fill="#0c1727"/><g fill="#cbd5e1" font-family="sans-serif" font-size="13">'+grid+ticks+'<text x="'+width/2+'" y="'+(height-9)+'" text-anchor="middle">预算（棱晶；横轴 log₂(预算+1)）</text><text transform="translate(16,'+height/2+') rotate(-90)" text-anchor="middle">有效伤害 / 秒</text>'+lines+'</g></svg>'
}
function table(scenario:string){const data=results.filter(r=>r.scenarioId===scenario);return '<div class="scroll"><table><thead><tr><th>构筑</th><th>预算</th><th>实花 / 余额</th><th>总 DPS</th><th>每靶平均</th><th>测量秒数</th><th>购卡顺序（价格）</th></tr></thead><tbody>'+data.map(r=>'<tr><td>'+esc(config.builds.find(b=>b.id===r.buildId)!.name)+'</td><td>'+r.budget+'</td><td>'+r.spent+' / '+r.remaining+'</td><td>'+fmt(r.dps)+'</td><td>'+fmt(r.averageTargetDps)+'</td><td>'+fmt(r.measurementSeconds)+(r.cycleLimited?'（周期不足）':'')+'</td><td>'+esc(r.available?r.orders.map(o=>o.name+' '+o.level+'级('+o.price+')').join(' → ')||'无':'未解锁：'+r.missing)+'</td></tr>').join('')+'</tbody></table></div>'}
const legend=config.builds.map((b,i)=>'<span><i style="background:'+colors[i%colors.length]+'"></i>'+esc(b.name)+'</span>').join('')
const sections=config.scenarios.map(s=>{const total=s.id+'-total.svg',avg=s.id+'-average.svg';writeFileSync(join(out,total),chart(s.id,'dps'));writeFileSync(join(out,avg),chart(s.id,'averageTargetDps'));const desc='靶数 '+s.targets.length+'；相对坐标 '+s.targets.map(t=>'('+t.x+', '+t.y+'；半径 '+(t.radius??34)+')').join('、')+'；统一防御 '+JSON.stringify(s.defense??{})+'；各靶防御 '+JSON.stringify(s.targets.map(t=>t.defense??{}));return '<section><h2>'+esc(s.name)+'</h2><p>'+esc(desc)+'</p><h3>总有效 DPS</h3><img src="'+total+'" alt="'+esc(s.name)+' 总有效 DPS 曲线">'+(s.targets.length>1?'<h3>每目标平均有效 DPS</h3><img src="'+avg+'" alt="'+esc(s.name)+' 平均有效 DPS 曲线">':'')+'<details><summary>展开预算与购卡明细</summary>'+table(s.id)+'</details></section>'}).join('')
const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PRISM 固定预算伤害曲线</title><style>body{margin:0;background:#07111f;color:#e2e8f0;font:16px/1.65 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:24px}h1,h2,h3{line-height:1.25}h1{color:#a5f3fc}section{border-top:1px solid #334155;padding:20px 0}p{color:#cbd5e1}a{color:#67e8f9}img{max-width:100%;height:auto;border-radius:8px}.legend{display:flex;flex-wrap:wrap;gap:12px}.legend span{white-space:nowrap}.legend i{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;border-bottom:1px solid #334155;padding:8px;vertical-align:top}td:last-child{min-width:320px}summary{cursor:pointer;color:#67e8f9}code{word-break:break-all}</style></head><body><main><h1>PRISM 固定预算伤害曲线</h1><p>这是指定靶场中的确定性模拟，不代表实战命中率或最优构筑。每个预算从零按固定顺序购买，未花余额不参与比较。地雷的触发和使用方式与主武器不同，不纳入本报告。</p><p>'+esc(metadata.purchaseRule)+' '+esc(metadata.scope)+' 预热 '+config.warmupSeconds+' 秒，测量至少 '+config.measurementSeconds+' 秒；慢速构筑延长至约十个基础冷却周期，最多 1200 秒，截断时标注。'+esc(metadata.measurement)+'。横轴为对数刻度。</p><p><a href="results.json">下载 JSON（完整配置和每靶结果）</a> · <a href="results.csv">下载 CSV</a> · <a href="https://github.com/what20360/prism/blob/main/docs/design/balance-evidence.md">实验方法与重新生成</a></p><div class="legend">'+legend+'</div>'+sections+'<section><h2>复现信息</h2><p>源码基线：<code>'+esc(metadata.commit)+'</code>；生成时工作区'+(metadata.dirty?'有未提交变动':'干净')+'。源码与配置 SHA-256：<code>'+metadata.sourceSha256+'</code>；种子 '+config.seed+'。</p></section></main></body></html>'
writeFileSync(join(out,'index.html'),html)
console.log('完成：'+results.length+' 组，耗时 '+((Date.now()-started)/1000).toFixed(1)+' 秒。报告：'+out)
