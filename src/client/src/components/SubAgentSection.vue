<script setup lang="ts">
import { Bot, ChevronDown, ChevronRight } from 'lucide-vue-next'
import AgentCard from './AgentCard.vue'
import type { Session, SubAgent } from '../../../../server/models.ts'

defineProps<{
  session: Session
  expandLevel: 0 | 1 | 2
  sortedSubAgents: SubAgent[]
  summary: string
}>()

defineEmits<{ cycle: [] }>()

function statusDotClass(a: SubAgent): string {
  if (a.status === 'active')   return 'bg-emerald-500 status-pulse'
  if (a.status === 'waiting')  return 'bg-amber-500'
  return 'bg-slate-400'
}

function statusLabel(a: SubAgent): string {
  switch (a.status) {
    case 'active':    return 'ACTIVE'
    case 'waiting':   return 'WAIT'
    case 'completed': return 'DONE'
    default:          return 'IDLE'
  }
}

function statusColor(a: SubAgent): string {
  if (a.status === 'active')  return 'color: #10b981'
  if (a.status === 'waiting') return 'color: #f59e0b'
  return 'color: var(--text-subtle)'
}

function taskProgress(a: SubAgent): number {
  if (!a.tasks?.length) return 0
  return (a.tasks.filter(t => t.status === 'completed').length / a.tasks.length) * 100
}

function taskDone(a: SubAgent): number {
  return (a.tasks ?? []).filter(t => t.status === 'completed').length
}

function formatCost(usd: number): string {
  if (usd < 0.001) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

function levelLabel(level: 0 | 1 | 2): string {
  return level === 0 ? '›› expand' : level === 1 ? '›› details' : '‹‹ collapse'
}
</script>

<template>
  <div class="mt-1 ml-3 pl-3 border-l-2" style="border-color: var(--border)">
    <!-- Header pill — always visible, click cycles levels -->
    <button
      class="flex items-center gap-2 px-2 py-1.5 w-full text-left rounded-lg transition-colors"
      style="background: var(--surface-inset); border: 1px solid var(--border)"
      @click="$emit('cycle')"
    >
      <Bot :size="12" style="color: var(--text-muted)" />
      <span class="text-xs font-semibold" style="color: var(--text-muted)">
        {{ session.subAgents.length }} sub-agent{{ session.subAgents.length !== 1 ? 's' : '' }}
      </span>
      <span v-if="summary" class="text-xs" style="color: var(--text-subtle)">· {{ summary }}</span>
      <span class="ml-auto text-xs flex-shrink-0" style="color: var(--text-subtle)">{{ levelLabel(expandLevel) }}</span>
      <ChevronDown
        :size="12"
        class="flex-shrink-0 transition-transform"
        :class="expandLevel === 2 ? 'rotate-180' : expandLevel === 1 ? '-rotate-90' : ''"
        style="color: var(--text-muted)"
      />
    </button>

    <!-- Level 1: compact rows -->
    <div v-if="expandLevel === 1" class="mt-1.5 space-y-1">
      <div
        v-for="a in sortedSubAgents"
        :key="a.agentId"
        class="flex items-center gap-2 px-2 py-1.5 rounded-lg"
        style="background: var(--surface-sub); border: 1px solid var(--border-subtle)"
      >
        <!-- Status dot -->
        <span :class="['w-1.5 h-1.5 rounded-full flex-shrink-0', statusDotClass(a)]" />

        <!-- Name -->
        <span class="text-xs font-medium truncate min-w-0 flex-1" style="color: var(--text-muted)">
          {{ a.slug || shortPath(a.cwd) }}
        </span>
        <span v-if="a.gitBranch" class="text-xs flex-shrink-0 truncate max-w-24" style="color: var(--text-subtle)">
          {{ a.gitBranch }}
        </span>

        <!-- Task progress bar -->
        <div v-if="a.tasks?.length" class="flex items-center gap-1 flex-shrink-0">
          <div class="w-16 h-1 rounded-full overflow-hidden" style="background: var(--border)">
            <div
              class="h-full rounded-full"
              style="background: #6366f1; transition: width 0.5s"
              :style="{ width: taskProgress(a) + '%' }"
            />
          </div>
          <span class="text-xs font-mono" style="color: var(--text-subtle)">{{ taskDone(a) }}/{{ a.tasks.length }}</span>
        </div>

        <!-- Cost -->
        <span class="text-xs font-mono flex-shrink-0 text-emerald-600">{{ formatCost(a.tokenUsage.estimatedCostUsd) }}</span>

        <!-- Status label -->
        <span class="text-xs font-semibold flex-shrink-0 w-10 text-right" :style="statusColor(a)">{{ statusLabel(a) }}</span>
      </div>
    </div>

    <!-- Level 2: full AgentCards -->
    <div v-else-if="expandLevel === 2" class="mt-2 space-y-2">
      <AgentCard
        v-for="a in sortedSubAgents"
        :key="a.agentId"
        :agent="a"
        :is-sub-agent="true"
      />
    </div>
  </div>
</template>
