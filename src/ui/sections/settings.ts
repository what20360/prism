import type { ControlSettings, SettingKey } from '../../app/game'

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
    hint: '自动：瞄准射程内最近的敌人。手动：瞄准鼠标位置，不受射程限制。',
    options: [
      { value: 'auto', label: '自动索敌' },
      { value: 'manual', label: '鼠标瞄准' },
    ],
  },
  {
    key: 'fireMode',
    label: '射击方式',
    hint: '自动：冷却好了就开火。手动：按住鼠标左键开火。',
    options: [
      { value: 'auto', label: '自动开火' },
      { value: 'manual', label: '按住左键开火' },
    ],
  },
]

export function renderSettingsSection(
  settings: ControlSettings,
  handlers: SettingsHandlers,
): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'settings'

  const note = document.createElement('p')
  note.className = 'menu__hint'
  note.textContent = '设置仅影响你如何下达指令，不改动任何战斗数值。'
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

  return wrapper
}
