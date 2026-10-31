import { bindings, setBinding, resetBindings, type BindingAction } from '../../input/bindings'
export function renderKeysSection(): HTMLElement {
 const root = document.createElement('div'), heading = document.createElement('h2'); heading.textContent = '按键绑定'; root.append(heading)
 const note = document.createElement('p'); note.textContent = '点击动作按钮后按下新按键。设置自动保存；方向键始终可用于移动。鼠标左键射击、右键锁定。'; root.append(note)
 const render = () => {
  root.querySelectorAll('button').forEach((b) => b.remove())
  const names: Record<BindingAction,string> = {up:'向上',down:'向下',left:'向左',right:'向右',mine:'地雷',skill1:'技能槽1',skill2:'技能槽2',restart:'重新开始',menu:'菜单'}
  for(const [key,code] of Object.entries(bindings())) {
   const button = document.createElement('button'); button.className = 'settings__option'; button.textContent = names[key as BindingAction]+'：'+code; button.setAttribute('aria-label','修改'+names[key as BindingAction]+'按键')
   button.onclick = () => { button.textContent = '请按新按键'; button.onkeydown = (event) => { event.preventDefault(); event.stopPropagation(); if(setBinding(key as BindingAction,event.code)) render(); else button.textContent = '按键冲突或不支持，请重试' } }; root.append(button)
  }
  const reset = document.createElement('button'); reset.textContent = '恢复默认按键'; reset.onclick = () => { resetBindings(); render() }; root.append(reset)
 }; render(); return root
}
