<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useNotifications } from './useNotifications.ts'
import { useNow } from './useNow.ts'
import { Wifi, WifiOff, RefreshCw, Bot, Sun, Moon, Layers, ChevronDown, Bell, BellOff } from 'lucide-vue-next'
import { useWebSocket } from './useWebSocket.ts'
import { useTheme } from './useTheme.ts'
import AgentCard from './components/AgentCard.vue'
import SubAgentSection from './components/SubAgentSection.vue'
import type { Session } from '../../../server/models.ts'

const { state, connected, lastUpdate } = useWebSocket()
const { theme, toggle: toggleTheme } = useTheme()
const now = useNow()

// ── Filter ───────────────────────────────────────────────────────────────────

type Filter = 'needs-response' | 'active' | 'recent' | 'all'

const RECENT_MS = 24 * 60 * 60 * 1000 // 24 hours

type SortKey = 'last-event' | 'cost' | 'tokens' | 'calls' | 'duration'

const filter = ref<Filter>('active')
const search = ref('')
const sortKey = ref<SortKey>('last-event')
const groupByProject = ref(false)

const allSessions = computed(() => state.value?.sessions ?? [])

const { permission: notifPermission, muted: notifMuted, toggleMute: toggleNotif } = useNotifications(allSessions)

function isActive(s: Session) {
  // active: running right now
  // waiting + recent: Claude finished and needs response, but only within 24h window
  // (old abandoned sessions with end_turn don't pollute the active view)
  return s.status === 'active' || (s.needsUserReaction && isRecent(s))
}

function isRecent(s: Session) {
  return Date.now() - new Date(s.lastActivity).getTime() < RECENT_MS
}

function needsResponse(s: Session) {
  return s.needsUserReaction && isRecent(s)
}

function matchesSearch(s: Session): boolean {
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  return (
    s.cwd.toLowerCase().includes(q) ||
    s.projectPath.toLowerCase().includes(q) ||
    (s.gitBranch?.toLowerCase().includes(q) ?? false) ||
    (s.currentTask?.toLowerCase().includes(q) ?? false) ||
    s.subAgents.some(a =>
      a.slug.toLowerCase().includes(q) ||
      a.cwd.toLowerCase().includes(q) ||
      (a.gitBranch?.toLowerCase().includes(q) ?? false)
    )
  )
}

const filteredSessions = computed(() => {
  const byFilter = (() => {
    switch (filter.value) {
      case 'needs-response': return allSessions.value.filter(needsResponse)
      case 'active': return allSessions.value.filter(isActive)
      case 'recent': return allSessions.value.filter(s => isActive(s) || isRecent(s))
      case 'all':    return allSessions.value
    }
  })()
  const searched = byFilter.filter(matchesSearch)

  return [...searched].sort((a, b) => {
    // needsUserReaction → top, then waiting, then rest
    const priority = (s: Session) => s.needsUserReaction ? 0 : s.status === 'waiting' ? 1 : 2
    const ap = priority(a), bp = priority(b)
    if (ap !== bp) return ap - bp

    switch (sortKey.value) {
      case 'last-event':
        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
      case 'cost':
        return sessionTotalCost(b) - sessionTotalCost(a)
      case 'tokens': {
        const tokA = a.tokenUsage.inputTokens + a.tokenUsage.outputTokens
          + a.subAgents.reduce((s, x) => s + x.tokenUsage.inputTokens + x.tokenUsage.outputTokens, 0)
        const tokB = b.tokenUsage.inputTokens + b.tokenUsage.outputTokens
          + b.subAgents.reduce((s, x) => s + x.tokenUsage.inputTokens + x.tokenUsage.outputTokens, 0)
        return tokB - tokA
      }
      case 'calls': {
        const callsA = a.toolCallCount + a.subAgents.reduce((s, x) => s + x.toolCallCount, 0)
        const callsB = b.toolCallCount + b.subAgents.reduce((s, x) => s + x.toolCallCount, 0)
        return callsB - callsA
      }
      case 'duration':
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    }
  })
})

interface ProjectGroup {
  key: string
  label: string
  sessions: Session[]
  activeSessions: number
  totalCost: number
  lastActivity: number
}

const groupedSessions = computed((): ProjectGroup[] | null => {
  if (!groupByProject.value) return null

  const map = new Map<string, ProjectGroup>()
  for (const s of filteredSessions.value) {
    // Strip --worktrees-... suffix so worktrees group with their base repo
    const key = s.projectDir.replace(/--worktrees.*$/, '')
    const label = key.split('--').pop() ?? key
    if (!map.has(key)) {
      map.set(key, { key, label, sessions: [], activeSessions: 0, totalCost: 0, lastActivity: 0 })
    }
    const g = map.get(key)!
    g.sessions.push(s)
    if (isActive(s)) g.activeSessions++
    g.totalCost += sessionTotalCost(s)
    const t = new Date(s.lastActivity).getTime()
    if (t > g.lastActivity) g.lastActivity = t
  }

  // Group priority = best session priority within the group
  const groupPriority = (g: ProjectGroup) =>
    g.sessions.some(s => s.needsUserReaction) ? 0 :
    g.sessions.some(s => s.status === 'active') ? 1 :
    g.sessions.some(s => s.status === 'waiting') ? 2 : 3

  return [...map.values()].sort((a, b) => {
    const pd = groupPriority(a) - groupPriority(b)
    if (pd !== 0) return pd
    return b.lastActivity - a.lastActivity
  })
})

const counts = computed(() => ({
  'needs-response': allSessions.value.filter(needsResponse).length,
  active: allSessions.value.filter(isActive).length,
  recent: allSessions.value.filter(s => isActive(s) || isRecent(s)).length,
  all:    allSessions.value.length,
}))

// ── Stats ─────────────────────────────────────────────────────────────────────

const totalActive    = computed(() => counts.value.active)
const totalSubAgents = computed(() => state.value?.totalSubAgents ?? 0)

function sessionTotalCost(session: Session): number {
  let c = session.tokenUsage.estimatedCostUsd
  for (const a of session.subAgents) c += a.tokenUsage.estimatedCostUsd
  return c
}

// Stats for the currently filtered view
const filteredStats = computed(() => ({
  subAgents: filteredSessions.value.reduce((acc, s) => acc + s.subAgents.length, 0),
  cost:      filteredSessions.value.reduce((acc, s) => acc + sessionTotalCost(s), 0),
}))

const grandTotalCost = computed(() =>
  allSessions.value.reduce((acc, s) => acc + sessionTotalCost(s), 0)
)

// ── Sub-agent expand state (0 = collapsed, 1 = compact, 2 = full) ─────────────
const subAgentLevel = ref(new Map<string, 0 | 1 | 2>())

// Auto-expand to compact level when switching to 'all' filter
watch(filter, (f) => {
  if (f === 'all') {
    const m = new Map(subAgentLevel.value)
    for (const s of allSessions.value) {
      if (s.subAgents.length > 0 && !m.has(s.sessionId)) m.set(s.sessionId, 1)
    }
    subAgentLevel.value = m
  }
})

function cycleSubAgents(sessionId: string) {
  const m = new Map(subAgentLevel.value)
  const cur = m.get(sessionId) ?? 0
  m.set(sessionId, cur === 0 ? 1 : cur === 1 ? 2 : 0)
  subAgentLevel.value = m
}

function subAgentSummary(session: Session): string {
  const subs = session.subAgents
  if (!subs.length) return ''
  const needs = subs.filter(a => a.needsUserReaction).length
  const active = subs.filter(a => a.status === 'active').length
  const waiting = subs.filter(a => a.status === 'waiting' && !a.needsUserReaction).length
  const parts: string[] = []
  if (needs)   parts.push(`${needs} needs response`)
  if (active)  parts.push(`${active} active`)
  if (waiting) parts.push(`${waiting} waiting`)
  const idle = subs.length - needs - active - waiting
  if (idle)    parts.push(`${idle} idle`)
  return parts.join(' · ')
}

function sortedSubAgents(session: Session) {
  return [...session.subAgents].sort((a, b) => {
    const priority = (s: typeof a) =>
      s.needsUserReaction ? 0 : s.status === 'active' ? 1 : s.status === 'waiting' ? 2 : 3
    return priority(a) - priority(b)
  })
}

function lastUpdatedLabel(): string {
  if (!lastUpdate.value) return 'never'
  const diff = now.value - lastUpdate.value.getTime()
  if (diff < 2000) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  return `${Math.floor(diff / 60_000)}m ago`
}

function formatCost(usd: number): string {
  if (usd < 0.01) return usd < 0.001 ? '<$0.01' : `$${usd.toFixed(2)}`
  return `$${usd.toFixed(2)}`
}
</script>

<template>
  <div class="min-h-screen" style="background: var(--bg); color: var(--text)">

    <!-- Header -->
    <header class="sticky top-0 z-10 border-b" style="background: var(--header-bg); border-color: var(--header-border)">
      <div class="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">

        <!-- Logo + title -->
        <div class="flex items-center gap-3">
          <svg viewBox="0 0 100 100" class="w-8 h-8 flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#0f172a"/>
            <!-- Bot body -->
            <rect x="22" y="8"  width="56" height="10" fill="#ea580c"/>
            <rect x="10" y="18" width="80" height="10" fill="#f97316"/>
            <rect x="6"  y="28" width="88" height="10" fill="#f97316"/>
            <rect x="6"  y="38" width="88" height="10" fill="#f97316"/>
            <rect x="6"  y="48" width="88" height="10" fill="#f97316"/>
            <rect x="10" y="58" width="80" height="10" fill="#ea580c"/>
            <rect x="22" y="68" width="56" height="8"  fill="#c2410c"/>
            <rect x="18" y="76" width="22" height="9"  fill="#c2410c"/>
            <rect x="60" y="76" width="22" height="9"  fill="#c2410c"/>
            <!-- Eye visor -->
            <rect x="6"  y="30" width="88" height="26" fill="#0f172a"/>
            <!-- Iris -->
            <rect x="30" y="31" width="40" height="24" rx="2" fill="#f97316"/>
            <!-- Pupil -->
            <rect x="40" y="35" width="20" height="16" rx="1" fill="#0f172a"/>
            <rect x="45" y="39" width="10" height="8"  fill="#0f172a"/>
            <!-- Highlight -->
            <rect x="32" y="33" width="10" height="6"  fill="white" opacity="0.28"/>
            <!-- Cockpit ticks -->
            <rect x="2"  y="40" width="6" height="4" fill="#f97316" opacity="0.6"/>
            <rect x="92" y="40" width="6" height="4" fill="#f97316" opacity="0.6"/>
          </svg>
          <div>
            <h1 class="text-sm font-bold leading-none">Claude Cockpit</h1>
            <p class="text-xs mt-0.5" style="color: var(--text-muted)">agent monitor</p>
          </div>
        </div>

        <!-- Stats -->
        <div class="flex items-center gap-6">
          <div class="text-center">
            <div class="text-lg font-bold text-emerald-500 leading-none">{{ totalActive }}</div>
            <div class="text-xs mt-0.5" style="color: var(--text-muted)">active</div>
          </div>
          <div class="text-center">
            <div class="text-lg font-bold text-violet-500 leading-none">{{ allSessions.length }}</div>
            <div class="text-xs mt-0.5" style="color: var(--text-muted)">sessions</div>
          </div>
          <div class="text-center">
            <div class="text-lg font-bold text-sky-500 leading-none">{{ totalSubAgents }}</div>
            <div class="text-xs mt-0.5" style="color: var(--text-muted)">sub-agents</div>
          </div>
          <div class="text-center">
            <div class="text-lg font-bold text-emerald-600 leading-none font-mono">{{ formatCost(grandTotalCost) }}</div>
            <div class="text-xs mt-0.5" style="color: var(--text-muted)">total cost</div>
          </div>
        </div>

        <!-- Right: connection + theme -->
        <div class="flex items-center gap-3">
          <span class="text-xs" style="color: var(--text-subtle)">{{ lastUpdatedLabel() }}</span>
          <div v-if="connected" class="flex items-center gap-1.5 text-emerald-500">
            <Wifi :size="14" />
            <span class="text-xs">live</span>
          </div>
          <div v-else class="flex items-center gap-1.5 text-red-400">
            <WifiOff :size="14" />
            <span class="text-xs">connecting...</span>
          </div>

          <!-- Notification toggle -->
          <button
            @click="toggleNotif"
            class="p-1.5 rounded-lg transition-colors"
            style="border: 1px solid var(--border)"
            :title="notifPermission === 'denied'  ? 'Notifications blocked — enable in browser settings' :
                    notifPermission === 'default'  ? 'Enable browser notifications' :
                    notifMuted                     ? 'Notifications muted — click to unmute' :
                                                     'Notifications on — click to mute'"
          >
            <Bell    v-if="notifPermission === 'granted' && !notifMuted" :size="14" class="text-amber-500" />
            <BellOff v-else                                               :size="14" style="color: var(--text-muted)" />
          </button>

          <!-- Theme toggle -->
          <button
            @click="toggleTheme"
            class="p-1.5 rounded-lg transition-colors"
            style="border: 1px solid var(--border)"
            :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          >
            <Sun v-if="theme === 'dark'" :size="14" style="color: var(--text-muted)" />
            <Moon v-else :size="14" style="color: var(--text-muted)" />
          </button>
        </div>
      </div>

      <!-- Filter bar -->
      <div class="max-w-7xl mx-auto px-6 pb-2 flex items-center gap-2">
        <button
          v-for="f in (['needs-response', 'active', 'recent', 'all'] as const)"
          :key="f"
          @click="filter = f"
          class="px-3 py-1 rounded-full text-xs font-medium transition-all flex-shrink-0"
          :style="filter === f
            ? (f === 'needs-response' ? 'background: #d97706; color: white;' : 'background: #6366f1; color: white;')
            : `background: var(--surface); color: var(--text-muted); border: 1px solid var(--border)`"
        >
          {{ f === 'needs-response' ? '⚑ Needs Response' : f === 'active' ? 'Active' : f === 'recent' ? 'Recent (24h)' : 'All' }}
          <span
            class="ml-1.5 px-1.5 py-0.5 rounded-full text-xs"
            :style="filter === f
              ? 'background: rgba(255,255,255,0.2)'
              : (f === 'needs-response' && counts['needs-response'] > 0 ? 'background: #d97706; color: white' : 'background: var(--border)')">{{ counts[f] }}</span>
        </button>

        <!-- Search input -->
        <div class="relative flex-1 max-w-64">
          <input
            v-model="search"
            type="text"
            placeholder="search project, branch, task..."
            class="w-full text-xs px-3 py-1 rounded-full outline-none transition-all"
            style="background: var(--surface); color: var(--text); border: 1px solid var(--border); placeholder-color: var(--text-subtle)"
            @keydown.escape="search = ''"
          />
          <button
            v-if="search"
            @click="search = ''"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-xs leading-none"
            style="color: var(--text-subtle)"
          >✕</button>
        </div>

        <!-- Group toggle -->
        <button
          @click="groupByProject = !groupByProject"
          class="p-1.5 rounded-lg transition-colors flex-shrink-0 ml-auto"
          :style="groupByProject
            ? 'background: #6366f1; color: white; border: 1px solid #6366f1'
            : `border: 1px solid var(--border); color: var(--text-muted)`"
          title="Group by project"
        >
          <Layers :size="13" />
        </button>

        <!-- Sort -->
        <select
          v-model="sortKey"
          class="text-xs px-2 py-1 rounded-full outline-none flex-shrink-0"
          style="background: var(--surface); color: var(--text-muted); border: 1px solid var(--border)"
        >
          <option value="last-event">Last event</option>
          <option value="cost">Cost</option>
          <option value="tokens">Tokens</option>
          <option value="calls">Tool calls</option>
          <option value="duration">Duration</option>
        </select>

        <!-- Filtered stats -->
        <div class="flex items-center gap-3 flex-shrink-0">
          <span class="text-xs" style="color: var(--text-subtle)">
            showing {{ filteredSessions.length }} of {{ allSessions.length }}
          </span>
          <span class="text-xs px-2 py-0.5 rounded" style="background: var(--surface); color: var(--text-muted); border: 1px solid var(--border)">
            {{ filteredStats.subAgents }} sub-agents
          </span>
          <span class="text-xs font-mono px-2 py-0.5 rounded text-emerald-600" style="background: var(--surface); border: 1px solid var(--border)">
            {{ formatCost(filteredStats.cost) }}
          </span>
        </div>
      </div>
    </header>

    <!-- Main content -->
    <main class="max-w-7xl mx-auto px-6 py-6">

      <!-- Loading -->
      <div v-if="!state" class="flex items-center justify-center h-64">
        <div class="flex items-center gap-3" style="color: var(--text-muted)">
          <RefreshCw :size="20" class="animate-spin" />
          <span>Connecting to Claude Cockpit server...</span>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else-if="filteredSessions.length === 0" class="flex flex-col items-center justify-center h-64 gap-4">
        <Bot :size="48" style="color: var(--border)" />
        <div class="text-center">
          <p class="text-sm" style="color: var(--text-muted)">
            {{ filter === 'needs-response' ? 'No sessions need your attention' : filter === 'active' ? 'No active sessions right now' : 'No sessions found' }}
          </p>
          <p class="text-xs mt-1" style="color: var(--text-subtle)">
            {{ filter !== 'all' ? 'Try switching to "All" to see older sessions' : 'Start a Claude Code session to see it here' }}
          </p>
        </div>
      </div>

      <!-- Sessions: flat view -->
      <div v-else-if="!groupByProject" class="space-y-4">
        <template v-for="session in filteredSessions" :key="session.sessionId">
          <AgentCard :agent="session" />
          <SubAgentSection
            v-if="session.subAgents.length > 0"
            :session="session"
            :expand-level="subAgentLevel.get(session.sessionId) ?? 0"
            :sorted-sub-agents="sortedSubAgents(session)"
            :summary="subAgentSummary(session)"
            @cycle="cycleSubAgents(session.sessionId)"
          />
        </template>
      </div>

      <!-- Sessions: grouped view -->
      <div v-else class="space-y-6">
        <div v-for="group in groupedSessions" :key="group.key">
          <div class="flex items-center gap-3 mb-3">
            <span class="text-xs font-semibold" style="color: var(--text-muted)">{{ group.label }}</span>
            <span v-if="group.activeSessions > 0" class="text-xs text-emerald-500">{{ group.activeSessions }} active</span>
            <span class="text-xs" style="color: var(--text-subtle)">{{ group.sessions.length }} session{{ group.sessions.length !== 1 ? 's' : '' }}</span>
            <div class="flex-1 border-t" style="border-color: var(--border)"></div>
            <span class="text-xs font-mono text-emerald-600">{{ formatCost(group.totalCost) }}</span>
          </div>
          <div class="space-y-4">
            <template v-for="session in group.sessions" :key="session.sessionId">
              <AgentCard :agent="session" />
              <SubAgentSection
                v-if="session.subAgents.length > 0"
                :session="session"
                :expanded="expandedSubAgents.has(session.sessionId)"
                :sorted-sub-agents="sortedSubAgents(session)"
                :summary="subAgentSummary(session)"
                @toggle="toggleSubAgents(session.sessionId)"
              />
            </template>
          </div>
        </div>
      </div>

    </main>
  </div>
</template>
