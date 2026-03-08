<script setup lang="ts">
import { Bot, ChevronDown } from 'lucide-vue-next'
import AgentCard from './AgentCard.vue'
import type { Session, SubAgent } from '../../../../server/models.ts'

defineProps<{
  session: Session
  expanded: boolean
  sortedSubAgents: SubAgent[]
  summary: string
}>()

defineEmits<{ toggle: [] }>()
</script>

<template>
  <div class="mt-1 ml-3 pl-3 border-l-2" style="border-color: var(--border)">
    <!-- Collapsed header — always visible -->
    <button
      class="flex items-center gap-2 px-2 py-1.5 w-full text-left rounded-lg transition-colors hover:bg-opacity-50"
      style="background: var(--surface-inset); border: 1px solid var(--border)"
      @click="$emit('toggle')"
    >
      <Bot :size="12" style="color: var(--text-muted)" />
      <span class="text-xs font-semibold" style="color: var(--text-muted)">
        {{ session.subAgents.length }} sub-agent{{ session.subAgents.length !== 1 ? 's' : '' }}
      </span>
      <span v-if="summary" class="text-xs" style="color: var(--text-subtle)">· {{ summary }}</span>
      <ChevronDown
        :size="12"
        class="ml-auto transition-transform flex-shrink-0"
        :class="expanded ? 'rotate-180' : ''"
        style="color: var(--text-muted)"
      />
    </button>

    <!-- Expanded list -->
    <div v-if="expanded" class="mt-2 space-y-2">
      <AgentCard
        v-for="subAgent in sortedSubAgents"
        :key="subAgent.agentId"
        :agent="subAgent"
        :is-sub-agent="true"
      />
    </div>
  </div>
</template>
