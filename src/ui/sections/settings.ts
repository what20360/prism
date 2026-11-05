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
    hint: '手动使用鼠标或右摇杆瞄准。自动偏好可先设置，购买自动索敌后生效。',
    options: [
      { value: 'auto', label: '自动索敌' },
      { value: 'manual', label: '鼠标瞄准' },
    ],
  },
  {
    key: 'fireMode',
    label: '射击方式',
    hint: '手动按住鼠标左键或触屏射击区。自动偏好可先设置，购买「自动扳机」后生效。',
    options: [
      { value: 'auto', label: '自动开火' },
      { value: 'manual', label: '按住左键开火' },
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
    const touch = document.createElement('button')
    touch.type = 'button'
    touch.className = 'settings__option'
    touch.textContent = `触屏摇杆：${settings.touchControls ? '始终显示' : '小屏自动显示'}`
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
