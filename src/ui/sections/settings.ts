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
    hint: '开局使用鼠标或右摇杆瞄准。自动索敌需要购买对应升级卡。',
    options: [
      { value: 'auto', label: '自动索敌' },
      { value: 'manual', label: '鼠标瞄准' },
    ],
  },
  {
    key: 'fireMode',
    label: '射击方式',
    hint: '开局按住鼠标左键或触屏射击区。自动开火需要购买「自动扳机」。',
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
      button.disabled = option.value === 'auto' && (field.key === 'aimMode' ? attrs.autoAim : attrs.autoFire) <= 0
      if (button.disabled) button.title = '请先购买对应升级卡'
      button.addEventListener('click', () => {
        handlers.onSetting(field.key, option.value as ControlSettings[typeof field.key])
      })
      group.append(button)
    }

    const hint = document.createElement('p')
    hint.className = 'settings__hint'
    hint.textContent = field.hint

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
    button.addEventListener('click', () => handlers.onSetting(key, settings[key] === false))
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
  touch.addEventListener('click', () => handlers.onSetting('touchControls', !settings.touchControls))
  wrapper.append(touch)
  const magnet = document.createElement('button'); magnet.type = 'button'; magnet.className = 'settings__option'
  magnet.disabled = attrs.pickupRadius <= 0
  magnet.textContent = `磁铁自动吸取：${magnet.disabled ? '未解锁' : settings.autoPickup !== false ? '开启' : '关闭'}`
  magnet.setAttribute('aria-pressed', String(!magnet.disabled && settings.autoPickup !== false))
  magnet.onclick = () => handlers.onSetting('autoPickup', settings.autoPickup === false)
  const magnetHint = document.createElement('p'); magnetHint.className = 'settings__hint'; magnetHint.textContent = '购买磁吸核心后，在范围内自动吸取资源。关闭后仍可接触拾取；满生命时保留血球。'
  wrapper.append(magnet, magnetHint)

  return wrapper
}
