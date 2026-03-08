import { ref, watch } from 'vue'

const STORAGE_KEY = 'cockpit-theme'

function getInitialTheme(): 'dark' | 'light' {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const theme = ref<'dark' | 'light'>(getInitialTheme())

function applyTheme(t: 'dark' | 'light') {
  document.documentElement.classList.toggle('dark', t === 'dark')
  localStorage.setItem(STORAGE_KEY, t)
}

applyTheme(theme.value)

watch(theme, applyTheme)

export function useTheme() {
  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }
  return { theme, toggle }
}
