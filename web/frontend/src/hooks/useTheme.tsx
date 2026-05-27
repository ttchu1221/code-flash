import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

const STORAGE_KEY = 'code-flash-theme'

// CSS variable definitions for each theme
const THEME_VARS: Record<Theme, Record<string, string>> = {
  dark: {
    '--bg-base':       '#0a0b10',
    '--bg-surface':    '#0f1117',
    '--bg-elevated':   '#161822',
    '--bg-hover':      'rgba(255,255,255,0.04)',
    '--bg-active':     'rgba(255,255,255,0.08)',
    '--text-primary':  '#e2e8f0',
    '--text-secondary':'#94a3b8',
    '--text-muted':    '#475569',
    '--text-faint':    '#334155',
    '--border':        'rgba(255,255,255,0.06)',
    '--border-strong': 'rgba(255,255,255,0.10)',
    '--accent':        '#7c3aed',
    '--accent-light':  '#a78bfa',
    '--accent-bg':     'rgba(139,92,246,0.10)',
    '--accent-border': 'rgba(139,92,246,0.20)',
    '--user-bubble':   'linear-gradient(135deg, #7c3aed, #4f46e5)',
    '--user-bubble-text': '#ffffff',
    '--assistant-bubble':  'rgba(255,255,255,0.04)',
    '--assistant-border':  'rgba(255,255,255,0.06)',
    '--code-bg':       '#0a0d14',
    '--input-bg':      'rgba(255,255,255,0.03)',
    '--input-focus':   'rgba(139,92,246,0.08)',
    '--scrollbar':     'rgba(255,255,255,0.08)',
    '--scrollbar-hover':'rgba(255,255,255,0.15)',
    '--shadow':        'rgba(0,0,0,0.4)',
    '--selection':     'rgba(139,92,246,0.3)',
  },
  light: {
    '--bg-base':       '#f8f9fc',
    '--bg-surface':    '#ffffff',
    '--bg-elevated':   '#f1f3f8',
    '--bg-hover':      'rgba(0,0,0,0.03)',
    '--bg-active':     'rgba(0,0,0,0.06)',
    '--text-primary':  '#1e293b',
    '--text-secondary':'#64748b',
    '--text-muted':    '#94a3b8',
    '--text-faint':    '#cbd5e1',
    '--border':        'rgba(0,0,0,0.08)',
    '--border-strong': 'rgba(0,0,0,0.12)',
    '--accent':        '#7c3aed',
    '--accent-light':  '#7c3aed',
    '--accent-bg':     'rgba(124,58,237,0.08)',
    '--accent-border': 'rgba(124,58,237,0.15)',
    '--user-bubble':   'linear-gradient(135deg, #7c3aed, #4f46e5)',
    '--user-bubble-text': '#ffffff',
    '--assistant-bubble':  'rgba(0,0,0,0.03)',
    '--assistant-border':  'rgba(0,0,0,0.06)',
    '--code-bg':       '#f6f8fa',
    '--input-bg':      'rgba(0,0,0,0.03)',
    '--input-focus':   'rgba(124,58,237,0.06)',
    '--scrollbar':     'rgba(0,0,0,0.1)',
    '--scrollbar-hover':'rgba(0,0,0,0.2)',
    '--shadow':        'rgba(0,0,0,0.08)',
    '--selection':     'rgba(124,58,237,0.15)',
  },
}

function applyThemeVars(theme: Theme) {
  const root = document.documentElement
  const vars = THEME_VARS[theme]
  for (const [key, val] of Object.entries(vars)) {
    root.style.setProperty(key, val)
  }
  // Toggle dark class for Tailwind dark: variants if needed
  root.classList.toggle('dark', theme === 'dark')
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  useEffect(() => {
    applyThemeVars(theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const setTheme = useCallback((t: Theme) => setThemeState(t), [])
  const toggleTheme = useCallback(() => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark')), [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
