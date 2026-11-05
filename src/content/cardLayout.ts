import type { CardCategory } from '../core/cards'
export const BASIC_CARD_TAGS = ['武器','伤害','弹道','生命','护盾','防御','技能','经济','移动','范围','地雷','视野','拾取','瞄准','射击'] as const
export type BasicCardTag = typeof BASIC_CARD_TAGS[number]
interface CardGroup {readonly id:CardCategory;readonly label:string;readonly cards:readonly (readonly [string,readonly BasicCardTag[]])[]}
/** Display order is independent of the numeric effect priority. Families stay next to their upgrades. */
export const CARD_GROUPS:readonly CardGroup[]=[
 {id:'weapon',label:'武器与专精',cards:[['precision-stance',['武器','伤害','弹道']],['sniper-specialty',['武器','伤害','移动']],['weapon-electric',['武器','伤害']],['arc-coil',['武器','伤害']],['weapon-laser',['武器','伤害','弹道']],['laser-focus',['武器','伤害','弹道']]]},
 {id:'damage',label:'伤害',cards:[['gun-damage',['伤害']],['gun-penetration',['伤害','防御']],['gun-inner',['伤害']],['heavy-stance',['伤害','防御','移动']],['glass-cannon',['伤害','生命']],['gun-firerate',['伤害','射击']],['burst',['伤害','射击']],['scatter',['伤害','弹道']],['explosive',['伤害','范围']]]},
 {id:'trajectory',label:'弹道',cards:[['gun-range',['弹道']],['gun-bulletspeed',['弹道']],['suspension',['弹道']],['homing',['弹道','瞄准']],['gun-size',['弹道','范围']],['gun-pierce',['弹道']],['ricochet',['弹道']],['pierce-drive',['弹道']]]},
 {id:'defense',label:'防御与恢复',cards:[['maxhp',['生命']],['armor',['防御']],['shield',['护盾']],['shield-regen',['护盾']],['lifesteal',['生命','伤害']],['gourmet',['生命']],['revive',['生命']]]},
 {id:'mine',label:'地雷',cards:[['mine-power',['地雷','伤害']],['mine-radius',['地雷','范围']],['mine-slow',['地雷','防御']],['mine-ignore',['地雷','防御']],['mine-cooldown',['地雷']],['mine-stock',['地雷']],['grenade',['地雷','弹道']],['sluggish',['地雷']],['shrapnel',['地雷','弹道','伤害']],['mine-echo',['地雷','伤害']],['mine-brood',['地雷','范围']]]},
 {id:'skill',label:'技能',cards:[['deflect',['技能','防御']],['reflect',['技能','伤害']],['rage',['技能','伤害','生命','防御']],['dash',['技能','移动']],['skill-cycle',['技能']]]},
 {id:'utility',label:'机动与辅助',cards:[['thruster',['移动']],['coward',['移动','生命']],['ascender',['视野']],['auto-aim',['瞄准']],['auto-fire',['射击']],['magnet',['拾取']],['shard-gain',['经济']],['miner',['经济']],['greed',['经济','生命']]]},
]
export const CARD_LAYOUT=Object.fromEntries(CARD_GROUPS.flatMap(group=>group.cards.map(([id,tags],index)=>[id,{category:group.id,tags,order:CARD_GROUPS.indexOf(group)*100+index}])))
export const cardCategoryLabel=(id:string)=>CARD_GROUPS.find(g=>g.id===id)?.label??id
