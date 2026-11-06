import type { ControlSettings, SettingKey } from '../../storage/config'
import type { AttrSet } from '../../core/attrs'

export interface SettingsHandlers {
  readonly onSetting: <K extends SettingKey>(key: K, value: ControlSettings[K]) => void
}

interface Option {
  readonly value: string
  readonly label: string
}

interface Field {
  readonly key: SettingKey
  readonly label: string
  readonly hint: string
  readonly options: readonly Option[]
}

const FIELDS: readonly Field[] = [
  {
    key: 'aimMode',
    label: '瞄准方式',
    hint: '手动使用鼠标或瞄准摇杆瞄准。自动偏好可先设置，购买自动索敌后生效。',
    options: [
      { value: 'auto', label: '自动索敌' },
      { value: 'manual', label: '手动瞄准' },
    ],
  },
  {
    key: 'fireMode',
    label: '射击方式',
    hint: '手动按住鼠标左键或触屏射击区。自动偏好可先设置，购买「自动扳机」后生效。',
    options: [
      { value: 'auto', label: '自动开火' },
      { value: 'manual', label: '手动开火' },
    ],
  },
]

export function renderSettingsSection(
  settings: ControlSettings,
  handlers: SettingsHandlers,
  attrs: AttrSet,
): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'settings'

  const onSetting = <K extends SettingKey>(key: K, value: ControlSettings[K]) => {
    settings = { ...settings, [key]: value }
    handlers.onSetting(key, value)
    render()
  }
  const render = () => {
    wrapper.replaceChildren()

    const note = document.createElement('p')
    note.className = 'menu__hint'
    note.textContent = '设置会自动保存在当前浏览器，刷新与重新开始后保留。'
    wrapper.append(note)

    for (const field of FIELDS) {
      const section = document.createElement('section')
      section.className = 'menu__section'

      const heading = document.createElement('h3')
      heading.className = 'menu__heading'
      heading.textContent = field.label
      section.append(heading)

      const group = document.createElement('div')
      group.className = 'settings__options'

      for (const option of field.options) {
        const active = settings[field.key] === option.value
        const button = document.createElement('button')
        button.type = 'button'
        button.className = active ? 'settings__option settings__option--active' : 'settings__option'
        button.textContent = option.label
        button.setAttribute('aria-pressed', String(active))
        button.addEventListener('click', () => {
          onSetting(field.key, option.value as ControlSettings[typeof field.key])
        })
        group.append(button)
      }

      const hint = document.createElement('p')
      hint.className = 'settings__hint'
      hint.textContent = field.hint + ((field.key==='aimMode'?attrs.autoAim:attrs.autoFire)<=0&&settings[field.key]==='auto'?' 已预设自动，购买对应卡片后生效。':'')

      section.append(group, hint)
      wrapper.append(section)
    }

    const audio = document.createElement('section')
    audio.className = 'menu__section settings__audio'
    const heading = document.createElement('h3')
    heading.textContent = '声音'
    audio.append(heading)
    for (const [key, label] of [['music', '背景音乐'], ['sfx', '战斗音效']] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'settings__option'
      button.textContent = `${label}：${settings[key] !== false ? '开启' : '关闭'}`
      button.setAttribute('aria-pressed', String(settings[key] !== false))
      button.addEventListener('click', () => onSetting(key, settings[key] === false))
      audio.append(button)
    }
    const hint = document.createElement('p')
    hint.className = 'settings__hint'
    hint.textContent = '首次点击或触摸后启用声音；切换到后台会暂停播放。'
    audio.append(hint)
    wrapper.append(audio)
    const slider=<K extends SettingKey>(key:K,label:string,min:number,max:number,step:number,current:number,convert:(n:number)=>ControlSettings[K],unit='')=>{
      const row=document.createElement('label');row.className='settings__slider';const name=document.createElement('span');name.textContent=label
      const value=document.createElement('output');value.textContent=String(Math.round(current*100)/100)+unit
      const input=document.createElement('input');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(current);input.setAttribute('aria-label',label)
      input.oninput=()=>{value.textContent=input.value+unit};input.onchange=()=>onSetting(key,convert(Number(input.value)))
      row.append(name,value,input);return row
    }
    audio.append(slider('musicVolume','音乐音量',0,100,1,(settings.musicVolume??.5)*100,n=>n/100,'%'),slider('sfxVolume','音效音量',0,100,1,(settings.sfxVolume??.65)*100,n=>n/100,'%'))
    const mobile=document.createElement('section');mobile.className='menu__section settings__mobile';const mobileHeading=document.createElement('h3');mobileHeading.textContent='触屏操作';mobile.append(mobileHeading)
    const choice=<K extends SettingKey>(key:K,label:string,values:readonly(readonly[string,string])[],current:string)=>{
      const wrap=document.createElement('label');wrap.className='settings__field';wrap.append(document.createTextNode(label));const select=document.createElement('select');select.setAttribute('aria-label',label)
      for(const [value,label]of values){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o)}select.value=current;select.onchange=()=>onSetting(key,select.value as ControlSettings[K]);wrap.append(select);return wrap
    }
    mobile.append(choice('touchStick','移动摇杆方式',[['fixed','固定位置'],['floating','随落指位置浮动']],settings.touchStick??'fixed'),choice('touchHand','操作布局',[['right','右手瞄准 · 左手移动'],['left','左手瞄准 · 右手移动']],settings.touchHand??'right'))
    mobile.append(slider('touchSize','摇杆尺寸',80,140,5,settings.touchSize??100,n=>n,'%'),slider('touchOpacity','控制透明度',30,100,5,(settings.touchOpacity??.65)*100,n=>n/100,'%'),slider('touchDeadzone','摇杆死区',5,30,1,(settings.touchDeadzone??.12)*100,n=>n/100,'%'),slider('touchInset','控制离屏幕边缘距离',8,60,2,settings.touchInset??18,n=>n,'px'))
    const mobileHint=document.createElement('p');mobileHint.className='settings__hint';mobileHint.textContent='瞄准摇杆按住射击，松手保留朝向；轻点战场锁定，滑动不锁定。浮动摇杆在移动侧下半屏落指定位。横竖屏都可游玩，布局旋转后会释放按键。';mobile.append(mobileHint)
    const reset=document.createElement('button');reset.type='button';reset.className='settings__option';reset.textContent='恢复默认触屏布局';reset.onclick=()=>{onSetting('touchStick','fixed');onSetting('touchHand','right');onSetting('touchSize',100);onSetting('touchOpacity',.65);onSetting('touchDeadzone',.12);onSetting('touchInset',18)};mobile.append(reset);wrapper.append(mobile)
    const experience=document.createElement('section');experience.className='menu__section';const experienceHeading=document.createElement('h3');experienceHeading.textContent='画面与联机';experience.append(experienceHeading)
    experience.append(choice('quality','画面效果',[['low','低功耗 · 减少拖尾和光效'],['balanced','均衡'],['high','高画质']],settings.quality??'balanced'))
    const prediction=document.createElement('button');prediction.type='button';prediction.className='settings__option';prediction.textContent=`本地移动预测：${settings.networkPrediction!==false?'开启':'关闭'}`;prediction.setAttribute('aria-pressed',String(settings.networkPrediction!==false));prediction.onclick=()=>onSetting('networkPrediction',settings.networkPrediction===false);experience.append(prediction)
    const predictionHint=document.createElement('p');predictionHint.className='settings__hint';predictionHint.textContent='预测让联机移动更跟手；若位置修正明显可关闭。弱网等待同步时停止预测。低功耗不减少敌人或改变伤害。';experience.append(predictionHint);wrapper.append(experience)
    const touch = document.createElement('button')
    touch.type = 'button'
    touch.className = 'settings__option'
    touch.textContent = `触屏摇杆：${settings.touchControls ? '始终显示' : '设备自动识别'}`
    touch.setAttribute('aria-pressed', String(settings.touchControls === true))
    touch.addEventListener('click', () => onSetting('touchControls', !settings.touchControls))
    wrapper.append(touch)
    const saves=document.createElement('section');saves.className='menu__section';const saveTitle=document.createElement('h3');saveTitle.textContent='自动存档';saves.append(saveTitle)
    const mode=document.createElement('select');mode.setAttribute('aria-label','自动存档方式');for(const [value,label]of [['room','每关一次'],['interval','定时保存（也在进关时保存）'],['off','关闭自动存档']]){const option=document.createElement('option');option.value=value!;option.textContent=label!;mode.append(option)}mode.value=settings.autoSaveMode??'room';mode.onchange=()=>onSetting('autoSaveMode',mode.value as ControlSettings['autoSaveMode']);saves.append(mode)
    if(settings.autoSaveMode==='interval'){const label=document.createElement('label');label.textContent='保存间隔（秒）';const seconds=document.createElement('input');seconds.type='number';seconds.min='5';seconds.max='3600';seconds.step='1';seconds.value=String(settings.autoSaveSeconds??60);seconds.setAttribute('aria-label','自动存档间隔秒数');seconds.onchange=()=>onSetting('autoSaveSeconds',Math.max(5,Math.min(3600,Math.round(Number(seconds.value)||60))));label.append(seconds);saves.append(label)}
    const saveHint=document.createElement('p');saveHint.className='settings__hint';saveHint.textContent='此处控制单人自动槽；手动保存和导出不受影响。联机合作由服务器的自动存档配置控制。';saves.append(saveHint);wrapper.append(saves)
    const magnet = document.createElement('button'); magnet.type = 'button'; magnet.className = 'settings__option'
    magnet.textContent = `磁铁自动吸取：${settings.autoPickup !== false ? attrs.pickupRadius>0?'开启':'开启（待购买磁吸核心）' : '关闭'}`
    magnet.setAttribute('aria-pressed', String(settings.autoPickup !== false))
    magnet.onclick = () => onSetting('autoPickup', settings.autoPickup === false)
    const magnetHint = document.createElement('p'); magnetHint.className = 'settings__hint'; magnetHint.textContent = '购买磁吸核心后，在范围内自动吸取资源。关闭后仍可接触拾取；满生命时保留血球。'
    wrapper.append(magnet, magnetHint)
  }
  render()

  return wrapper
}
