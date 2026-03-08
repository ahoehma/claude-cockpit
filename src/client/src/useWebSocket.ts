import { ref, onUnmounted } from 'vue'
import type { CockpitState } from '../../../server/models.ts'

export function useWebSocket() {
  const state = ref<CockpitState | null>(null)
  const connected = ref(false)
  const lastUpdate = ref<Date | null>(null)

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // In dev (Vite proxy): same host/port. In prod: server handles WS on same port.
  const WS_URL = `ws://${window.location.host}/ws`

  function connect() {
    ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      connected.value = true
      console.log('[ws] connected')
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; payload?: CockpitState; state?: CockpitState }
        if (msg.type === 'state' && msg.payload) {
          state.value = msg.payload
          lastUpdate.value = new Date()
        } else if (msg.type === 'hook' && msg.state) {
          state.value = msg.state
          lastUpdate.value = new Date()
        }
      } catch (e) {
        console.warn('[ws] parse error', e)
      }
    }

    ws.onclose = () => {
      connected.value = false
      console.log('[ws] disconnected — reconnecting in 2s')
      reconnectTimer = setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  connect()

  onUnmounted(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    ws?.close()
  })

  return { state, connected, lastUpdate }
}
