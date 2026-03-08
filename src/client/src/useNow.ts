import { ref, onUnmounted } from 'vue'

const now = ref(Date.now())

// Single shared interval for all components
let refCount = 0
let timer: ReturnType<typeof setInterval> | null = null

export function useNow() {
  refCount++
  if (!timer) {
    timer = setInterval(() => { now.value = Date.now() }, 10_000)
  }

  onUnmounted(() => {
    refCount--
    if (refCount === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  })

  return now
}
