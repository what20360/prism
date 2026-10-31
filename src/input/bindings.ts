export const DEFAULT_BINDINGS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', mine: 'KeyE', skill1: 'KeyJ', skill2: 'KeyK', restart: 'KeyR', menu: 'Escape' } as const
export type BindingAction = keyof typeof DEFAULT_BINDINGS
let current: Record<BindingAction, string> | undefined
export function bindings(): Record<BindingAction, string> {
  if (!current) {
    current = { ...DEFAULT_BINDINGS }
    try { const saved = JSON.parse(localStorage.getItem('prism.bindings') ?? '{}'); const values = Object.values(saved); if (Object.keys(saved).length === 9 && new Set(values).size === 9 && values.every((v) => typeof v === 'string' && /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Escape|ShiftLeft|ControlLeft|F[1-9])$/.test(v))) current = saved } catch { /* Storage is optional. */ }
  }
  return { ...current! }
}
export function setBinding(action: BindingAction, code: string): boolean {
  const next = bindings()
  if (!/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Escape|ShiftLeft|ControlLeft|F[1-9])$/.test(code) || Object.entries(next).some(([key, value]) => key !== action && value === code)) return false
  next[action] = code; current = next
  try { localStorage.setItem('prism.bindings', JSON.stringify(next)) } catch { /* Session still works. */ }
  return true
}
export function resetBindings(): void { current = { ...DEFAULT_BINDINGS }; try { localStorage.removeItem('prism.bindings') } catch { /* Optional. */ } }
