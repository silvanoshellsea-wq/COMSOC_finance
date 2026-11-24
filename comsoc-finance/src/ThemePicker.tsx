import { useState } from 'react'

const themes = {
  light: 'Lavender',
  dark: 'Dark',
  cherry: 'Cherry',
  'cherry-dark': 'Cherry Dark',
} as const
type Theme = keyof typeof themes
const storageKey = 'comsoc-finance-theme'

function preferredTheme(): Theme {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored && Object.hasOwn(themes, stored)) return stored as Theme
  } catch {
    // The theme can still be changed when browser storage is unavailable.
  }
  return 'light'
}

export function initializeTheme() {
  document.documentElement.dataset.theme = preferredTheme()
}

export default function ThemePicker() {
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme as Theme | undefined) ?? preferredTheme())

  function choose(next: Theme) {
    setTheme(next)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem(storageKey, next) } catch { /* Apply for this page only. */ }
  }

  return <label className="finance-theme-picker">
    <span>Theme</span>
    <select value={theme} onChange={(event) => choose(event.target.value as Theme)}>
      {Object.entries(themes).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </select>
  </label>
}
