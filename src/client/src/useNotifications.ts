import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { Session } from '../../../server/models.ts'

// sessionId → timestamp of last notification (module-level, survives re-renders)
const lastNotified = new Map<string, number>()
const COOLDOWN_MS = 5 * 60_000  // re-notify same session at most every 5 min

export function useNotifications(allSessions: Ref<Session[]>) {
  const permission = ref<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  )

  const muted = ref(localStorage.getItem('notif-muted') === '1')

  async function requestPermission() {
    if (!('Notification' in window)) return
    permission.value = await Notification.requestPermission()
  }

  function toggleMute() {
    if (permission.value !== 'granted') {
      requestPermission()
      return
    }
    muted.value = !muted.value
    localStorage.setItem('notif-muted', muted.value ? '1' : '0')
  }

  function fire(session: Session) {
    if (permission.value !== 'granted' || muted.value) return
    if (document.visibilityState === 'visible') return

    const project = session.projectPath.split(/[\\/]/).pop() ?? session.projectPath
    const branch  = session.gitBranch ? ` (${session.gitBranch})` : ''
    const body    = session.lastAssistantText
      ? session.lastAssistantText.slice(0, 120)
      : `${project}${branch} is waiting for your input`

    const n = new Notification(`Claude Cockpit — action needed`, { body, silent: false })
    n.onclick = () => { window.focus(); n.close() }
  }

  // Watch for sessions transitioning into needsUserReaction
  watch(allSessions, (sessions) => {
    const now = Date.now()

    for (const s of sessions) {
      if (!s.needsUserReaction) continue
      const last = lastNotified.get(s.sessionId) ?? 0
      if (now - last > COOLDOWN_MS) {
        lastNotified.set(s.sessionId, now)
        fire(s)
      }
    }
  }, { deep: false })

  return { permission, muted, toggleMute }
}
