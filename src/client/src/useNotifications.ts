import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { Session } from '../../../server/models.ts'

// sessionId → timestamp of last notification (module-level, survives re-renders)
const lastNotified = new Map<string, number>()
const COOLDOWN_MS = 5 * 60_000  // re-notify same session at most every 5 min
const STARTUP_TIME = Date.now()  // ignore sessions that were already stale when page loaded

// sessionId → last alerted context threshold (75 or 90), to avoid repeat alerts
const lastContextAlert = new Map<string, number>()

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

  function fireContext(session: Session, pct: number) {
    if (permission.value !== 'granted' || muted.value) return
    const project = session.projectPath.split(/[\\/]/).pop() ?? session.projectPath
    const n = new Notification(`Claude Cockpit — context ${pct}% full`, {
      body: `${project}${session.gitBranch ? ` (${session.gitBranch})` : ''} — auto-compact may happen soon`,
      silent: false,
    })
    n.onclick = () => { window.focus(); n.close() }
  }

  // Watch for sessions transitioning into needsUserReaction or hitting context thresholds
  watch(allSessions, (sessions) => {
    const now = Date.now()

    for (const s of sessions) {
      // User response needed — skip if session was already stale when page loaded
      if (s.needsUserReaction) {
        const activityMs = new Date(s.lastActivity).getTime()
        if (activityMs > STARTUP_TIME) {
          const last = lastNotified.get(s.sessionId) ?? 0
          if (now - last > COOLDOWN_MS) {
            lastNotified.set(s.sessionId, now)
            fire(s)
          }
        }
      }

      // Context window alerts (75% and 90%), only for active sessions
      if (s.status === 'active' && (s as any).contextTokens && (s as any).contextLimit) {
        const pct = Math.round(((s as any).contextTokens / (s as any).contextLimit) * 100)
        const threshold = pct >= 90 ? 90 : pct >= 75 ? 75 : 0
        if (threshold > 0) {
          const lastThreshold = lastContextAlert.get(s.sessionId) ?? 0
          if (lastThreshold < threshold) {
            lastContextAlert.set(s.sessionId, threshold)
            fireContext(s, threshold)
          }
        } else {
          // Reset when context drops back (e.g. after auto-compact)
          lastContextAlert.delete(s.sessionId)
        }
      }
    }
  }, { deep: false })

  return { permission, muted, toggleMute }
}
