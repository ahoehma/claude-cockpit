<script setup lang="ts">
import { computed } from 'vue'
import { Bot } from 'lucide-vue-next'
import type { Session, SubAgent } from '../../../../server/models.ts'

interface ProjectGroup {
  key: string
  label: string
  sessions: Session[]
  activeSessions: number
  totalCost: number
}

const props = defineProps<{
  sessions: Session[]
  groups: ProjectGroup[] | null
  now: number
}>()

// Flatten grouped or flat sessions into a single renderable list
type RowGroup   = { kind: 'group';   label: string; count: number; active: number; cost: number }
type RowSession = { kind: 'session'; session: Session }
type RowSub     = { kind: 'sub';     sub: SubAgent; parentBranch?: string }
type RowSep     = { kind: 'sep';     id: string }
type Row = RowGroup | RowSession | RowSub | RowSep

const rows = computed((): Row[] => {
  const out: Row[] = []
  const pushSession = (s: Session) => {
    out.push({ kind: 'session', session: s })
    for (const sub of s.subAgents) {
      out.push({ kind: 'sub', sub, parentBranch: s.gitBranch })
    }
    out.push({ kind: 'sep', id: s.sessionId })
  }
  if (props.groups) {
    for (const g of props.groups) {
      out.push({ kind: 'group', label: g.label, count: g.sessions.length, active: g.activeSessions, cost: g.totalCost })
      for (const s of g.sessions) pushSession(s)
    }
  } else {
    for (const s of props.sessions) pushSession(s)
  }
  return out
})

function statusDotCls(status: string, needsReaction: boolean, waitingKind?: string) {
  if (needsReaction && waitingKind === 'needs-decision') return 'bg-amber-500 animate-pulse shadow-[0_0_6px_2px_rgba(245,158,11,0.6)]'
  if (needsReaction)         return 'bg-indigo-400 shadow-[0_0_6px_2px_rgba(129,140,248,0.5)]'
  if (status === 'active')   return 'bg-emerald-500 animate-pulse shadow-[0_0_6px_2px_rgba(16,185,129,0.5)]'
  if (status === 'waiting')  return 'bg-slate-500'
  return 'bg-slate-700'
}

function statusLabel(status: string, needsReaction: boolean, waitingKind?: string) {
  if (needsReaction && waitingKind === 'needs-decision') return { text: 'NEEDS',  cls: 'text-amber-500' }
  if (needsReaction)         return { text: 'OUTPUT', cls: 'text-indigo-400' }
  if (status === 'active')   return { text: 'ACTIVE', cls: 'text-emerald-500' }
  if (status === 'waiting')  return { text: 'DONE',   cls: 'text-slate-400' }
  return                            { text: 'IDLE',   cls: 'text-slate-600' }
}

function ageLabel(lastActivity: string) {
  const ms = props.now - new Date(lastActivity).getTime()
  if (ms < 60_000)     return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)}m`
  return `${Math.floor(ms / 3_600_000)}h`
}

function actionLabel(s: Session | SubAgent): string {
  const tool = s.currentTool ?? s.lastTool
  if (!tool) return s.lastAssistantText?.split('\n')[0].slice(0, 70) ?? '—'
  const input = tool.input as Record<string, unknown>
  const name  = tool.name
  if (name === 'Read' || name === 'Write' || name === 'Edit') {
    const p = String(input.file_path ?? input.path ?? '')
    return `${name}: ${p.split(/[/\\]/).pop() ?? p}`
  }
  if (name === 'Bash')     return `Bash: ${String(input.command ?? '').slice(0, 60)}`
  if (name === 'Grep')     return `Grep: ${String(input.pattern ?? '')}`
  if (name === 'Glob')     return `Glob: ${String(input.pattern ?? '')}`
  if (name === 'WebFetch') return `Fetch: ${String(input.url ?? '').slice(0, 60)}`
  return name
}

function sessionCost(s: Session) {
  return s.tokenUsage.estimatedCostUsd + s.subAgents.reduce((a, x) => a + x.tokenUsage.estimatedCostUsd, 0)
}

function formatCost(usd: number) {
  if (usd < 0.005) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function projectLabel(s: Session) {
  return s.projectPath.split(/[/\\]/).pop() ?? s.projectPath
}

const COL = '20px 1fr 1fr 36px 64px 40px'
</script>

<template>
  <div class="font-mono text-xs" style="color: var(--text)">

    <!-- Column headers -->
    <div class="grid-row" :style="`grid-template-columns: ${COL}`" style="padding: 6px 4px; font-size: 0.65rem; letter-spacing: 0.08em;">
      <div></div>
      <div style="color: var(--text-subtle)">PROJECT / BRANCH</div>
      <div style="color: var(--text-subtle)">CURRENT ACTION</div>
      <div style="color: var(--text-subtle)">SUB</div>
      <div class="text-right" style="color: var(--text-subtle)">COST</div>
      <div class="text-right" style="color: var(--text-subtle)">AGE</div>
    </div>
    <div class="divider" style="border-color: var(--border)"></div>

    <!-- Empty -->
    <div v-if="rows.length === 0" class="flex items-center gap-2 py-8 px-1" style="color: var(--text-subtle)">
      <Bot :size="20" /><span>No sessions</span>
    </div>

    <!-- All rows -->
    <template v-for="row in rows" :key="row.kind === 'sep' ? 'sep-' + row.id : row.kind === 'session' ? row.session.sessionId : row.kind === 'sub' ? row.sub.agentId : row.label">

      <!-- Group header -->
      <div v-if="row.kind === 'group'" class="grid-row group-header" :style="`grid-template-columns: ${COL}`">
        <div></div>
        <div class="font-semibold" style="color: var(--text-muted)">{{ row.label }}</div>
        <div class="flex items-center gap-2">
          <span v-if="row.active > 0" class="text-emerald-500">{{ row.active }} active</span>
          <span style="color: var(--text-subtle)">{{ row.count }} session{{ row.count !== 1 ? 's' : '' }}</span>
        </div>
        <div></div>
        <div class="text-right text-emerald-600">{{ formatCost(row.cost) }}</div>
        <div></div>
      </div>

      <!-- Group divider -->
      <div v-else-if="row.kind === 'group'" class="divider" style="border-color: var(--border)"></div>

      <!-- Session row -->
      <div
        v-else-if="row.kind === 'session'"
        class="grid-row session-row"
        :class="row.session.needsUserReaction ? 'row-needs' : row.session.status === 'active' ? 'row-active' : ''"
        :style="`grid-template-columns: ${COL}`"
      >
        <div class="flex items-center justify-center">
          <span class="w-2 h-2 rounded-full flex-shrink-0"
            :class="statusDotCls(row.session.status, row.session.needsUserReaction, row.session.waitingKind)" />
        </div>
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-semibold truncate" style="color: var(--text)">{{ projectLabel(row.session) }}</span>
          <span v-if="row.session.gitBranch" class="truncate flex-shrink-0" style="color: var(--text-subtle)">{{ row.session.gitBranch }}</span>
        </div>
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-semibold flex-shrink-0 w-12 text-right"
            :class="statusLabel(row.session.status, row.session.needsUserReaction, row.session.waitingKind).cls">
            {{ statusLabel(row.session.status, row.session.needsUserReaction, row.session.waitingKind).text }}
          </span>
          <span class="truncate" style="color: var(--text-muted)">{{ actionLabel(row.session) }}</span>
        </div>
        <div class="text-right" style="color: var(--text-subtle)">
          {{ row.session.subAgents.length > 0 ? row.session.subAgents.length : '—' }}
        </div>
        <div class="text-right" :class="sessionCost(row.session) > 0.5 ? 'text-amber-500' : 'text-emerald-600'">
          {{ formatCost(sessionCost(row.session)) }}
        </div>
        <div class="text-right" style="color: var(--text-subtle)">{{ ageLabel(row.session.lastActivity) }}</div>
      </div>

      <!-- Sub-agent row -->
      <div
        v-else-if="row.kind === 'sub'"
        class="grid-row session-row sub-row"
        :class="row.sub.needsUserReaction ? 'row-needs' : row.sub.status === 'active' ? 'row-active' : ''"
        :style="`grid-template-columns: ${COL}`"
      >
        <div class="flex items-center justify-center">
          <span class="w-1.5 h-1.5 rounded-full"
            :class="statusDotCls(row.sub.status, row.sub.needsUserReaction, row.sub.waitingKind)" />
        </div>
        <div class="flex items-center gap-1.5 min-w-0 pl-4">
          <span style="color: var(--text-subtle)">↳</span>
          <span class="truncate" style="color: var(--text-muted)">{{ row.sub.slug }}</span>
          <span v-if="row.sub.gitBranch && row.sub.gitBranch !== row.parentBranch" class="truncate flex-shrink-0" style="color: var(--text-subtle)">{{ row.sub.gitBranch }}</span>
        </div>
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-semibold flex-shrink-0 w-12 text-right"
            :class="statusLabel(row.sub.status, row.sub.needsUserReaction, row.sub.waitingKind).cls">
            {{ statusLabel(row.sub.status, row.sub.needsUserReaction, row.sub.waitingKind).text }}
          </span>
          <span class="truncate" style="color: var(--text-subtle)">{{ actionLabel(row.sub) }}</span>
        </div>
        <div></div>
        <div class="text-right" style="color: var(--text-subtle)">{{ formatCost(row.sub.tokenUsage.estimatedCostUsd) }}</div>
        <div class="text-right" style="color: var(--text-subtle)">{{ ageLabel(row.sub.lastActivity) }}</div>
      </div>

      <!-- Separator -->
      <div v-else-if="row.kind === 'sep'" class="sep" style="border-color: var(--border)"></div>

    </template>
  </div>
</template>

<style scoped>
.grid-row {
  display: grid;
  align-items: center;
  gap: 0 12px;
  padding: 0 4px;
}

.session-row {
  height: 28px;
  border-radius: 3px;
  transition: background 0.15s;
}

.sub-row { height: 24px; }

.session-row:hover { background: var(--surface); }
.row-needs         { background: rgba(245, 158, 11, 0.04); }
.row-active        { background: rgba(16, 185, 129, 0.03); }
.row-needs:hover   { background: rgba(245, 158, 11, 0.08); }
.row-active:hover  { background: rgba(16, 185, 129, 0.07); }

.group-header {
  padding: 10px 4px 4px;
  font-size: 0.7rem;
}

.divider {
  border-top: 1px solid;
  margin: 2px 0 4px;
}

.sep {
  border-top: 1px solid;
  margin: 1px 0;
  opacity: 0.3;
}
</style>
