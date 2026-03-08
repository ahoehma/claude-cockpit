<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNow } from '../useNow.ts'
import { GitBranch, Clock, Timer, Zap, Eye, RefreshCw, ChevronRight, ChevronDown, Terminal, FileEdit, Search, Globe, Bot, MessageSquare, Loader2 } from 'lucide-vue-next'
import type { Session, SubAgent } from '../../../../server/models.ts'

const now = useNow()

const props = defineProps<{
  agent: Session | SubAgent
  isSubAgent?: boolean
}>()

// ── Expand state ──────────────────────────────────────────────────────────────
const promptExpanded  = ref(false)
const actionExpanded  = ref(false)
const tasksExpanded   = ref(false)

// ── Status ────────────────────────────────────────────────────────────────────
const statusConfig = computed(() => {
  const wk = (props.agent as any).waitingKind as string | undefined
  if (props.agent.needsUserReaction) {
    return { color: 'text-amber-500', bg: 'bg-amber-500', label: 'NEEDS RESPONSE', pulse: true }
  }
  if (props.agent.status === 'waiting' && wk === 'output-available') {
    return { color: 'text-indigo-400', bg: 'bg-indigo-400', label: 'OUTPUT READY', pulse: false }
  }
  switch (props.agent.status) {
    case 'active':    return { color: 'text-emerald-500', bg: 'bg-emerald-500', label: 'ACTIVE',   pulse: true }
    case 'waiting':   return { color: 'text-slate-400',   bg: 'bg-slate-400',   label: 'DONE',     pulse: false }
    case 'idle':      return { color: 'text-slate-400',   bg: 'bg-slate-400',   label: 'IDLE',     pulse: false }
    case 'completed': return { color: 'text-slate-500',   bg: 'bg-slate-500',   label: 'DONE',     pulse: false }
  }
})

const integrationBadge = computed(() => {
  if (props.isSubAgent) return null
  const s = props.agent as Session
  switch (s.integrationMode) {
    case 'hooks':    return { icon: Zap,       label: 'Hooks',    cls: 'text-violet-500 border-violet-400' }
    case 'watching': return { icon: Eye,       label: 'Watching', cls: 'text-sky-500 border-sky-400' }
    case 'polling':  return { icon: RefreshCw, label: 'Polling',  cls: 'text-slate-400 border-slate-400' }
  }
})

// ── Labels ────────────────────────────────────────────────────────────────────
const projectLabel = computed(() => {
  if (props.isSubAgent) {
    const a = props.agent as SubAgent
    return a.slug || a.agentId.slice(0, 12)
  }
  const s = props.agent as Session
  const parts = s.cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    const secondLast = parts[parts.length - 2]
    if (secondLast === '.worktrees' || secondLast === 'worktrees') {
      return `${parts[parts.length - 3] ?? ''}/.worktrees/${last}`
    }
  }
  return parts[parts.length - 1] || s.cwd
})

const projectPath = computed(() => props.agent.cwd.replace(/\\/g, '/'))

// ── Time ──────────────────────────────────────────────────────────────────────
function relativeTime(ts: string): string {
  const diff = now.value - new Date(ts).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function duration(start: string | null, end?: string | null, ms?: number): string {
  if (ms !== undefined) return formatMs(ms)
  if (!start) return '—'
  const endMs = end ? new Date(end).getTime() : now.value
  return formatMs(endMs - new Date(start).getTime())
}

const grossDuration = computed(() => {
  const activeMs = (props.agent as any).activeTimeMs as number | undefined
  const start = props.agent.startTime
  const end = props.agent.status === 'active' ? undefined : props.agent.lastActivity
  const endMs = end ? new Date(end).getTime() : now.value
  const gross = endMs - new Date(start).getTime()
  if (!activeMs) return formatMs(gross)  // no active time data — just show gross
  // Only hide if they're nearly identical (< 5min difference)
  if (gross - activeMs < 5 * 60_000) return null
  return formatMs(gross)
})

// ── Cost / tokens ─────────────────────────────────────────────────────────────
function formatCost(usd: number): string {
  if (usd < 0.01) return usd < 0.001 ? '<$0.01' : `$${usd.toFixed(2)}`
  return `$${usd.toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const displayCost = computed(() => {
  if (props.isSubAgent) return props.agent.tokenUsage.estimatedCostUsd
  const s = props.agent as Session
  return s.tokenUsage.estimatedCostUsd +
    s.subAgents.reduce((acc: number, a) => acc + a.tokenUsage.estimatedCostUsd, 0)
})

const hasSubAgentCost = computed(() => {
  if (props.isSubAgent) return false
  const s = props.agent as Session
  return s.subAgents.length > 0 && s.subAgents.some(a => a.tokenUsage.estimatedCostUsd > 0)
})

// ── Context window ────────────────────────────────────────────────────────────
const contextPct = computed(() => {
  const a = props.agent as any
  if (!a.contextTokens || !a.contextLimit) return null
  return Math.min(100, Math.round((a.contextTokens / a.contextLimit) * 100))
})

const contextBar = computed(() => {
  const pct = contextPct.value
  if (pct === null) return null
  if (props.agent.status === 'completed') return null
  const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981'
  return { pct, color }
})

function formatK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

// ── Task progress ─────────────────────────────────────────────────────────────
const taskDone     = computed(() => (props.agent.tasks ?? []).filter(t => t.status === 'completed').length)
const taskProgress = computed(() => props.agent.tasks?.length ? (taskDone.value / props.agent.tasks.length) * 100 : 0)
const taskActive   = computed(() => (props.agent.tasks ?? []).find(t => t.status === 'in_progress'))

// ── Current action ────────────────────────────────────────────────────────────
const currentAction = computed(() => {
  const tool = props.agent.currentTool ?? props.agent.lastTool
  if (!tool) return null
  return describeToolCall(tool.name, tool.input, tool)
})

function describeToolCall(name: string, input: Record<string, unknown>, tool?: { name: string; input: Record<string, unknown> }) {
  const raw = tool ?? { name, input }
  switch (name) {
    case 'Bash':    return { icon: Terminal,     label: 'Bash',  summary: String(input.command ?? '').slice(0, 80), full: String(input.command ?? ''), lang: 'bash' }
    case 'Read':    return { icon: FileEdit,     label: 'Read',  summary: shortPath(String(input.file_path ?? '')), full: String(input.file_path ?? ''), lang: 'path' }
    case 'Write':   return { icon: FileEdit,     label: 'Write', summary: shortPath(String(input.file_path ?? '')), full: String(input.file_path ?? ''), lang: 'path' }
    case 'Edit':    return { icon: FileEdit,     label: 'Edit',  summary: shortPath(String(input.file_path ?? '')), full: String(input.file_path ?? ''), lang: 'path' }
    case 'Glob':    return { icon: Search,       label: 'Glob',  summary: String(input.pattern ?? ''), full: String(input.pattern ?? ''), lang: 'text' }
    case 'Grep':    return { icon: Search,       label: 'Grep',  summary: `${input.pattern} in ${input.path ?? '.'}`, full: JSON.stringify(input, null, 2), lang: 'json' }
    case 'Agent':   return { icon: Bot,          label: 'Agent', summary: 'spawning sub-agent...', full: JSON.stringify(input, null, 2), lang: 'json' }
    case 'WebFetch':return { icon: Globe,        label: 'Fetch', summary: String(input.url ?? '').slice(0, 60), full: String(input.url ?? ''), lang: 'text' }
    default:        return { icon: ChevronRight, label: name,    summary: '', full: JSON.stringify(input, null, 2), lang: 'json' }
  }
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  if (parts.length <= 3) return p
  return '.../' + parts.slice(-2).join('/')
}

// ── Waiting / attention block ────────────────────────────────────────────────

// How long since last activity (in ms) - recomputed as now ticks
const ageMs = computed(() => now.value - new Date(props.agent.lastActivity).getTime())

const attentionBlock = computed(() => {
  const a = props.agent

  // Stuck-tool case: idle but tool was dispatched with no result (e.g. hook waiting, tool timed out)
  if (a.needsUserReaction && a.status === 'idle') {
    const lastTool = a.lastTool
    if (lastTool) {
      const minWaiting = Math.floor(ageMs.value / 60_000)
      return { kind: 'stuck' as const, text: `${lastTool.name} was dispatched ${minWaiting}m ago but got no result — go to terminal` }
    }
    return { kind: 'stuck' as const, text: 'Session may need your attention in the terminal' }
  }

  if (a.status !== 'waiting') return null

  const wk = (a as any).waitingKind as string | undefined

  // output-available: show the output but only if recent (within 2h)
  if (wk === 'output-available') {
    if (ageMs.value > 2 * 3600_000) return null
    if (a.lastAssistantText) return { kind: 'output' as const, text: a.lastAssistantText }
    return null
  }

  if (!a.needsUserReaction) return null  // old session, no longer needs response

  // Claude finished its turn (end_turn) — show last message
  if (a.lastAssistantText) {
    return { kind: 'message' as const, text: a.lastAssistantText }
  }

  // Tool dispatched but no result yet
  const lastTool = a.lastTool
  if (lastTool && ageMs.value > 60_000) {
    return { kind: 'stuck' as const, text: `Last action: ${lastTool.name} — no response for ${Math.floor(ageMs.value / 60_000)}m` }
  }

  return { kind: 'waiting' as const, text: null }
})

function trimMessage(text: string, maxLen = 240): string {
  const first = text.split('\n\n')[0]
  return first.length > maxLen ? first.slice(0, maxLen) + '...' : first
}
</script>

<template>
  <div
    class="rounded-xl border transition-all duration-200"
    :style="isSubAgent
      ? `background: var(--surface-sub); border-color: var(--border-subtle)`
      : agent.needsUserReaction
        ? 'background: var(--surface); border-color: #d97706; box-shadow: 0 0 0 1px #d9770640, 0 4px 12px #d9770618'
        : (agent as any).waitingKind === 'output-available' && agent.status === 'waiting'
          ? 'background: var(--surface); border-color: #6366f1; box-shadow: 0 0 0 1px #6366f120'
          : agent.status === 'active'
            ? 'background: var(--surface); border-color: #10b981; box-shadow: 0 0 0 1px #10b98120'
            : `background: var(--surface); border-color: var(--border)`"
  >
    <!-- ── Header ── -->
    <div class="flex items-start justify-between px-4 pt-3 pb-2">
      <!-- Left: status dot + name + branch -->
      <div class="flex items-center gap-2 min-w-0">
        <span :class="['w-2 h-2 rounded-full flex-shrink-0', statusConfig.bg, statusConfig.pulse ? 'status-pulse' : '']" />
        <span v-if="isSubAgent" class="flex-shrink-0" style="color: var(--text-subtle)">
          <ChevronRight :size="12" class="inline" />
        </span>
        <div class="min-w-0">
          <span class="font-semibold text-sm truncate block">{{ projectLabel }}</span>
          <span class="text-xs truncate block" style="color: var(--text-subtle)">{{ projectPath }}</span>
        </div>
        <span v-if="agent.gitBranch" class="flex items-center gap-1 text-xs flex-shrink-0" style="color: var(--text-subtle)">
          <GitBranch :size="11" />
          <span class="truncate max-w-32">{{ agent.gitBranch }}</span>
        </span>
      </div>
      <!-- Right: status + integration badge + ctx% -->
      <div class="flex flex-col items-end gap-1 flex-shrink-0 ml-3">
        <div class="flex items-center gap-2">
          <span :class="['text-xs font-mono font-semibold', statusConfig.color]">{{ statusConfig.label }}</span>
          <span
            v-if="integrationBadge"
            :class="['flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border', integrationBadge.cls]"
          >
            <component :is="integrationBadge.icon" :size="10" />
            {{ integrationBadge.label }}
          </span>
        </div>
        <!-- Context % under status label -->
        <div v-if="contextBar" class="flex items-center gap-1.5">
          <div class="w-14 h-1 rounded-full overflow-hidden" style="background: var(--border)">
            <div
              class="h-full rounded-full transition-all duration-500"
              :style="{ width: contextBar.pct + '%', background: contextBar.color }"
            />
          </div>
          <span
            class="text-xs font-mono"
            :style="{ color: contextBar.color }"
            :title="`${formatK((agent as any).contextTokens)} / ${formatK((agent as any).contextLimit)} tokens`"
          >{{ contextBar.pct }}%</span>
        </div>
      </div>
    </div>

    <!-- ── Initial prompt ── -->
    <div v-if="agent.currentTask" class="mx-4 mb-2 rounded-lg border overflow-hidden" style="border-color: var(--border-inset)">
      <button
        class="w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors"
        style="background: var(--surface-inset)"
        @click="promptExpanded = !promptExpanded"
      >
        <span class="text-xs font-medium" style="color: var(--text-subtle)">Initial prompt</span>
        <ChevronDown
          :size="12"
          class="flex-shrink-0 transition-transform"
          :class="promptExpanded ? 'rotate-180' : ''"
          style="color: var(--text-subtle)"
        />
      </button>
      <div
        class="px-3 overflow-hidden transition-all duration-200"
        :style="promptExpanded ? 'max-height: 400px; padding-bottom: 10px; padding-top: 6px' : 'max-height: 52px; padding-bottom: 8px; padding-top: 6px'"
      >
        <p
          class="text-xs leading-relaxed"
          :class="promptExpanded ? '' : 'line-clamp-2'"
          style="color: var(--text-muted); white-space: pre-wrap; word-break: break-word"
        >{{ agent.currentTask }}</p>
      </div>
    </div>

    <!-- ── Task progress ── -->
    <div v-if="agent.tasks?.length" class="mx-4 mb-2 rounded-lg border overflow-hidden" style="border-color: var(--border-inset)">
      <!-- progress bar header row — click to expand -->
      <button
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left"
        style="background: var(--surface-inset)"
        @click="tasksExpanded = !tasksExpanded"
      >
        <div class="flex-1 h-1.5 rounded-full overflow-hidden" style="background: var(--border)">
          <div
            class="h-full rounded-full transition-all duration-500"
            style="background: #6366f1"
            :style="{ width: taskProgress + '%' }"
          />
        </div>
        <span class="text-xs font-mono flex-shrink-0" style="color: var(--text-subtle)">
          {{ taskDone }} / {{ agent.tasks.length }}
        </span>
        <ChevronDown
          :size="11"
          class="flex-shrink-0 transition-transform"
          :class="tasksExpanded ? 'rotate-180' : ''"
          style="color: var(--text-subtle)"
        />
      </button>
      <!-- current in_progress label (collapsed only) -->
      <p v-if="!tasksExpanded && taskActive" class="px-3 pb-1.5 text-xs truncate" style="color: var(--text-muted)">
        ↳ {{ taskActive.activeForm || taskActive.subject }}
      </p>
      <!-- expanded task list -->
      <div v-if="tasksExpanded" class="border-t px-3 py-2 space-y-1" style="border-color: var(--border-inset)">
        <div
          v-for="task in agent.tasks"
          :key="task.id"
          class="flex items-start gap-2"
        >
          <span class="flex-shrink-0 mt-0.5 text-xs w-3 text-center">
            <span v-if="task.status === 'completed'" class="text-emerald-500">✓</span>
            <span v-else-if="task.status === 'in_progress'" class="text-indigo-400">›</span>
            <span v-else style="color: var(--text-subtle)">○</span>
          </span>
          <span
            class="text-xs leading-relaxed"
            :style="task.status === 'completed'
              ? 'color: var(--text-subtle); text-decoration: line-through'
              : task.status === 'in_progress'
                ? 'color: var(--text)'
                : 'color: var(--text-muted)'"
          >{{ task.subject }}</span>
        </div>
      </div>
    </div>

    <!-- ── Last exchange ── -->
    <template v-if="agent.status !== 'active'">
      <div
        v-if="agent.lastUserText || (!attentionBlock && agent.lastAssistantText)"
        class="mx-4 mb-2 rounded-lg overflow-hidden border"
        style="border-color: var(--border-inset)"
      >
        <div v-if="agent.lastUserText" class="flex items-start gap-2 px-3 py-2" :class="{ 'border-b': !attentionBlock && agent.lastAssistantText }" style="border-color: var(--border-inset)">
          <span class="text-xs flex-shrink-0 font-semibold mt-0.5 w-4" style="color: var(--text-subtle)">›</span>
          <p class="text-xs leading-relaxed line-clamp-2" style="color: var(--text-muted)">{{ agent.lastUserText }}</p>
        </div>
        <div v-if="!attentionBlock && agent.lastAssistantText" class="flex items-start gap-2 px-3 py-2">
          <span class="text-xs flex-shrink-0 font-semibold mt-0.5 w-4" style="color: var(--text-subtle)">ai</span>
          <p class="text-xs leading-relaxed line-clamp-2" style="color: var(--text-muted)">{{ trimMessage(agent.lastAssistantText) }}</p>
        </div>
      </div>
    </template>
    <!-- Active: last user input + current action combined -->
    <template v-else>
      <div class="mx-4 mb-2 rounded-lg overflow-hidden border" style="border-color: var(--border-inset)">
        <div v-if="agent.lastUserText" class="flex items-start gap-2 px-3 py-2 border-b" style="border-color: var(--border-inset)">
          <span class="text-xs flex-shrink-0 font-semibold mt-0.5 w-4" style="color: var(--text-subtle)">›</span>
          <p class="text-xs leading-relaxed line-clamp-2" style="color: var(--text-muted)">{{ agent.lastUserText }}</p>
        </div>
        <div
          class="flex items-center gap-2 px-3 py-2"
          :style="agent.needsUserReaction && currentAction ? 'background: rgba(217,119,6,0.08)' : ''"
        >
          <Loader2 v-if="!currentAction" :size="11" class="text-indigo-400 flex-shrink-0 animate-spin" />
          <component v-else :is="currentAction.icon" :size="11" :class="agent.needsUserReaction ? 'text-amber-500' : 'text-indigo-400'" class="flex-shrink-0" />
          <button
            v-if="currentAction"
            class="flex items-center gap-2 flex-1 min-w-0 text-left"
            @click="actionExpanded = !actionExpanded"
          >
            <span class="text-xs font-semibold flex-shrink-0" :class="agent.needsUserReaction ? 'text-amber-500' : 'text-indigo-400'">{{ currentAction.label }}</span>
            <span class="text-xs truncate font-mono" style="color: var(--text-muted)">{{ currentAction.summary }}</span>
            <ChevronDown :size="11" class="flex-shrink-0 ml-auto transition-transform" :class="actionExpanded ? 'rotate-180' : ''" style="color: var(--text-subtle)" />
          </button>
          <span v-else class="text-xs" style="color: var(--text-subtle)">working...</span>
          <span v-if="agent.needsUserReaction && currentAction" class="text-xs font-semibold text-amber-500 flex-shrink-0">← confirm in terminal</span>
        </div>
        <div v-if="currentAction && actionExpanded" class="border-t" style="border-color: var(--border-inset)">
          <pre class="px-3 py-2 text-xs overflow-x-auto leading-relaxed" style="color: var(--text-muted); white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto">{{ currentAction.full }}</pre>
        </div>
      </div>
    </template>

    <!-- ── Attention block ── -->
    <div
      v-if="attentionBlock"
      class="mx-4 mb-2 rounded-lg border overflow-hidden"
      :style="attentionBlock.kind === 'output'
        ? 'border-color: #6366f1; background: rgba(99, 102, 241, 0.05)'
        : 'border-color: #d97706; background: rgba(217, 119, 6, 0.06)'"
    >
      <div
        class="flex items-center gap-2 px-3 py-1.5"
        :style="attentionBlock.kind === 'output'
          ? 'background: rgba(99, 102, 241, 0.08)'
          : 'background: rgba(217, 119, 6, 0.1)'"
      >
        <MessageSquare
          :size="12"
          class="flex-shrink-0"
          :class="attentionBlock.kind === 'output' ? 'text-indigo-400' : 'text-amber-500'"
        />
        <span
          class="text-xs font-semibold"
          :class="attentionBlock.kind === 'output' ? 'text-indigo-400' : 'text-amber-500'"
        >
          {{ attentionBlock.kind === 'stuck'   ? '⚠ Go to terminal — action may be required'
           : attentionBlock.kind === 'output'  ? 'Output ready'
           :                                     'Waiting for your response' }}
        </span>
      </div>
      <div v-if="attentionBlock.text" class="px-3 py-2">
        <p class="text-xs leading-relaxed" style="color: var(--text-muted); white-space: pre-wrap; word-break: break-word">
          {{ trimMessage(attentionBlock.text) }}
        </p>
      </div>
      <div v-else class="px-3 py-2">
        <p class="text-xs" style="color: var(--text-subtle)">Check the terminal — Claude may be asking you something.</p>
      </div>
    </div>

    <!-- ── Current action (non-active sessions: last tool used) ── -->
    <div
      v-if="currentAction && agent.status !== 'active'"
      class="mx-4 mb-2 rounded-lg border overflow-hidden"
      style="background: var(--surface-inset); border-color: var(--border-inset)"
    >
      <button
        class="w-full flex items-center gap-2 px-3 py-2 text-left"
        @click="actionExpanded = !actionExpanded"
      >
        <component :is="currentAction.icon" :size="13" class="text-indigo-500 flex-shrink-0" />
        <span class="text-indigo-500 text-xs font-semibold flex-shrink-0">{{ currentAction.label }}</span>
        <span class="text-xs truncate font-mono flex-1" style="color: var(--text-muted)">{{ currentAction.summary }}</span>
        <ChevronDown
          :size="11"
          class="flex-shrink-0 transition-transform"
          :class="actionExpanded ? 'rotate-180' : ''"
          style="color: var(--text-subtle)"
        />
      </button>
      <div v-if="actionExpanded" class="border-t" style="border-color: var(--border-inset)">
        <pre
          class="px-3 py-2 text-xs overflow-x-auto leading-relaxed"
          style="color: var(--text-muted); white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto"
        >{{ currentAction.full }}</pre>
      </div>
    </div>

    <!-- Stats row -->
    <div
      class="flex items-center gap-4 px-4 pb-3 pt-1 border-t mt-1"
      style="border-color: var(--border-subtle)"
    >
      <span class="flex items-center gap-1 text-xs" style="color: var(--text-subtle)" title="Session duration">
        <Timer :size="11" />
        {{ (agent as any).activeTimeMs ? duration(null, null, (agent as any).activeTimeMs) : grossDuration }}<span
          v-if="(agent as any).activeTimeMs && grossDuration"
          class="ml-1 opacity-50"
        >({{ grossDuration }})</span>
      </span>
      <span class="flex items-center gap-1 text-xs" style="color: var(--text-subtle)" title="Last activity">
        <Clock :size="11" />
        {{ relativeTime(agent.lastActivity) }}
      </span>
      <span
        class="text-xs font-mono ml-auto"
        style="color: var(--text-subtle)"
        :title="isSubAgent ? (agent as any).agentId : (agent as any).sessionId"
      >{{ (isSubAgent ? (agent as any).agentId : (agent as any).sessionId).slice(0, 8) }}</span>
      <span class="text-xs" style="color: var(--text-subtle)">{{ agent.toolCallCount }} calls</span>
      <span
        v-if="!isSubAgent && (agent as any).subAgents?.length > 0"
        class="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
        style="background: var(--surface-inset); color: var(--text-muted); border: 1px solid var(--border)"
      >
        <Bot :size="10" />
        {{ (agent as any).subAgents.length }}
      </span>
      <span class="text-xs" style="color: var(--text-muted)">
        {{ formatTokens(agent.tokenUsage.inputTokens + agent.tokenUsage.outputTokens) }} tok
      </span>
      <span class="text-xs font-mono text-emerald-600">
        {{ formatCost(displayCost) }}
        <span v-if="hasSubAgentCost" class="text-xs" style="color: var(--text-subtle)"> total</span>
      </span>
    </div>
  </div>
</template>
