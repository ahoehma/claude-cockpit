import { readFileSync } from 'fs'
import type { Session, SubAgent, TokenUsage, ToolCall, SessionStatus, AgentTask, WaitingKind } from './models.ts'

const QUESTION_RE = /(\?)\s*$|(\?)\s*\n\s*$/m
const DECISION_RE = /\b(soll ich|shall i|would you like|do you want|möchtest du|willst du|bitte bestätige|please confirm|let me know what|tell me (what|which|how)|wie soll ich|was soll ich|which (option|approach)|what (should|would)|can i (proceed|continue|go ahead)|darf ich|soll das)\b/i

function looksLikeDecisionNeeded(text: string): boolean {
  const t = text.trim()
  // Last non-empty line ends with ?
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean)
  const lastLine = lines[lines.length - 1] ?? ''
  if (lastLine.endsWith('?')) return true
  // Pattern match
  return DECISION_RE.test(t)
}

const COST_PER_M_INPUT = 3.0    // USD per million input tokens (Sonnet)
const COST_PER_M_OUTPUT = 15.0  // USD per million output tokens
const COST_PER_M_CACHE_WRITE = 3.75
const COST_PER_M_CACHE_READ = 0.3

function calcCost(usage: Omit<TokenUsage, 'estimatedCostUsd'>): number {
  return (
    (usage.inputTokens / 1_000_000) * COST_PER_M_INPUT +
    (usage.outputTokens / 1_000_000) * COST_PER_M_OUTPUT +
    (usage.cacheCreationTokens / 1_000_000) * COST_PER_M_CACHE_WRITE +
    (usage.cacheReadTokens / 1_000_000) * COST_PER_M_CACHE_READ
  )
}

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 }
}

function describeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash': {
      const cmd = String(input.command ?? '').slice(0, 80)
      return `Bash: ${cmd}`
    }
    case 'Read': return `Read: ${input.file_path ?? ''}`
    case 'Write': return `Write: ${input.file_path ?? ''}`
    case 'Edit': return `Edit: ${input.file_path ?? ''}`
    case 'Glob': return `Glob: ${input.pattern ?? ''}`
    case 'Grep': return `Grep: ${input.pattern ?? ''} in ${input.path ?? '.'}`
    case 'Agent': return `Agent: spawning sub-agent`
    case 'WebFetch': return `Fetch: ${String(input.url ?? '').slice(0, 60)}`
    default: return `${name}`
  }
}

const CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4':     200_000,
  'claude-sonnet-4':   200_000,
  'claude-haiku-4':    200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-5-haiku':  200_000,
  'claude-3-opus':     200_000,
}

function contextLimitForModel(model?: string): number {
  if (!model) return 200_000
  for (const [prefix, limit] of Object.entries(CONTEXT_LIMITS)) {
    if (model.startsWith(prefix)) return limit
  }
  return 200_000
}

export function parseJsonl(filePath: string): {
  cwd: string
  gitBranch?: string
  sessionId: string
  version?: string
  startTime?: string
  lastActivity?: string
  status: SessionStatus
  currentTool?: ToolCall
  lastTool?: ToolCall
  currentTask?: string
  lastUserText?: string
  tokenUsage: TokenUsage
  toolCallCount: number
  tasks: AgentTask[]
  contextTokens?: number
  contextLimit: number
  waitingKind?: WaitingKind
  activeTimeMs: number
} {
  let lines: string[]
  try {
    lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
  } catch {
    return { cwd: '', sessionId: '', status: 'completed', tokenUsage: emptyUsage(), toolCallCount: 0 }
  }

  let cwd = ''
  let gitBranch: string | undefined
  let sessionId = ''
  let version: string | undefined
  let startTime: string | undefined
  let lastActivity: string | undefined
  let currentTask: string | undefined
  const usage: Omit<TokenUsage, 'estimatedCostUsd'> = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
  let toolCallCount = 0
  let lastTool: ToolCall | undefined
  let lastUserText: string | undefined
  let lastAssistantText: string | undefined
  let lastAssistantFullText: string | undefined  // untruncated, used for question detection
  let lastContextTokens: number | undefined
  let model: string | undefined
  // Task tracking: tool_use.id → task (pending result), numeric id → task (confirmed)
  const pendingTasks = new Map<string, Omit<AgentTask, 'id'>>()  // tool_use.id → partial
  const tasks        = new Map<string, AgentTask>()              // numeric id → task
  // For status detection
  let lastRole: 'user' | 'assistant' | undefined
  let lastStopReason: string | null = null
  let lastMsgHasToolResult = false
  let lastMsgHasToolUse = false
  const allTimestamps: number[] = []  // for active time calculation

  for (const line of lines) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    const ts = entry.timestamp as string | undefined

    // First user message in the session → session metadata
    if (!sessionId && entry.sessionId) {
      sessionId = entry.sessionId as string
      cwd = (entry.cwd as string) ?? ''
      gitBranch = entry.gitBranch as string | undefined
      version = entry.version as string | undefined
      if (ts) startTime = ts
    }

    if (ts) { lastActivity = ts; allTimestamps.push(new Date(ts).getTime()) }

    const msg = entry.message as Record<string, unknown> | undefined
    if (!msg) continue

    // Extract first user text message as task description (skip tool results)
    if (msg.role === 'user' && !currentTask) {
      const content = msg.content
      if (typeof content === 'string') {
        currentTask = content.slice(0, 120)
      } else if (Array.isArray(content)) {
        for (const block of content as Record<string, unknown>[]) {
          if (block.type === 'text' && typeof block.text === 'string') {
            currentTask = block.text.slice(0, 120)
            break
          }
        }
      }
    }

    // Track last message role + content type for status detection
    if (msg.role === 'user') {
      lastRole = 'user'
      const content = msg.content
      lastMsgHasToolResult = Array.isArray(content) &&
        (content as Record<string, unknown>[]).some(b => b.type === 'tool_result')
      lastMsgHasToolUse = false

      // Track last user text (not tool results)
      if (!lastMsgHasToolResult) {
        if (typeof content === 'string' && content.trim()) {
          lastUserText = content.slice(0, 200)
        } else if (Array.isArray(content)) {
          const parts = (content as Record<string, unknown>[])
            .filter(b => b.type === 'text' && typeof b.text === 'string')
            .map(b => (b.text as string).trim())
            .filter(Boolean)
          if (parts.length) lastUserText = parts.join('\n').slice(0, 200)
        }
      }

      // Resolve pending TaskCreate calls: "Task #3 created successfully: ..."
      if (Array.isArray(content)) {
        for (const block of content as Record<string, unknown>[]) {
          if (block.type !== 'tool_result') continue
          const toolUseId = block.tool_use_id as string | undefined
          if (!toolUseId || !pendingTasks.has(toolUseId)) continue
          const partial = pendingTasks.get(toolUseId)!
          pendingTasks.delete(toolUseId)
          const resultText = Array.isArray(block.content)
            ? (block.content as Record<string, unknown>[]).map(b => b.text ?? '').join('')
            : String(block.content ?? '')
          const match = resultText.match(/Task\s+#?(\d+)/i)
          const numericId = match ? match[1] : String(tasks.size + 1)
          tasks.set(numericId, { ...partial, id: numericId })
        }
      }
    }

    // Assistant messages: extract tool calls + usage
    if (msg.role === 'assistant') {
      lastRole = 'assistant'
      lastStopReason = (msg.stop_reason as string | null) ?? null
      lastMsgHasToolResult = false

      const msgContent = msg.content as Record<string, unknown>[]
      lastMsgHasToolUse = false
      if (Array.isArray(msgContent)) {
        let textParts: string[] = []
        for (const block of msgContent) {
          if (block.type === 'tool_use') {
            toolCallCount++
            lastMsgHasToolUse = true
            const toolName = block.name as string
            const toolInput = (block.input ?? {}) as Record<string, unknown>
            lastTool = { name: toolName, input: toolInput, timestamp: ts ?? new Date().toISOString() }

            if (toolName === 'TaskCreate') {
              pendingTasks.set(block.id as string, {
                subject:    String(toolInput.subject    ?? ''),
                activeForm: String(toolInput.activeForm ?? toolInput.subject ?? ''),
                status:     'pending',
              })
            } else if (toolName === 'TaskUpdate') {
              const taskId = String(toolInput.taskId ?? '')
              const task   = tasks.get(taskId)
              if (task) task.status = (toolInput.status as AgentTask['status']) ?? task.status
            }
          }
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            textParts.push(block.text.trim())
          }
        }
        if (textParts.length > 0) {
          lastAssistantFullText = textParts.join('\n\n')
          lastAssistantText = lastAssistantFullText.slice(0, 200)
        }
      }

      // Accumulate token usage — use only top-level cache_creation_input_tokens.
      // The nested cache_creation.ephemeral_* fields are the same values broken out,
      // so we must NOT add both or we double-count.
      if (!model && msg.model) model = msg.model as string

      const u = msg.usage as Record<string, unknown> | undefined
      if (u) {
        usage.inputTokens        += (u.input_tokens as number) || 0
        usage.outputTokens       += (u.output_tokens as number) || 0
        usage.cacheCreationTokens += (u.cache_creation_input_tokens as number) || 0
        usage.cacheReadTokens    += (u.cache_read_input_tokens as number) || 0
        // Track latest context size — must include cache_read + cache_creation since Claude Code
        // sends most tokens via cache (input_tokens alone is often just 3)
        const it = ((u.input_tokens as number) || 0)
                 + ((u.cache_read_input_tokens as number) || 0)
                 + ((u.cache_creation_input_tokens as number) || 0)
        if (it > 0) lastContextTokens = it
      }
    }
  }

  const tokenUsage: TokenUsage = { ...usage, estimatedCostUsd: calcCost(usage) }

  const now = Date.now()
  const ageMs = lastActivity ? now - new Date(lastActivity).getTime() : Infinity

  // Status detection based on conversation state + message age:
  //
  //  active  — Claude is actively doing something RIGHT NOW:
  //            • last assistant msg has stop_reason=null (still streaming)
  //            • last assistant msg has stop_reason=tool_use (tool dispatched, result pending) and recent
  //            • last user msg contains tool_result (tool finished, Claude about to respond) and recent
  //
  //  waiting — session exists but waiting on the user (end_turn) or brief pause
  //
  //  idle    — no activity for a while
  //
  // 10 minutes: generous window for long-running tools (npm install, tests, etc.)
  const ACTIVE_MS = 10 * 60_000

  let status: SessionStatus

  const streaming      = lastRole === 'assistant' && lastStopReason === null
  const toolDispatched = lastRole === 'assistant' && lastStopReason === 'tool_use'
  const toolCompleted  = lastRole === 'user' && lastMsgHasToolResult
  // User sent a text message (no tool_result) — Claude is about to respond
  const userTyping     = lastRole === 'user' && !lastMsgHasToolResult
  const claudeFinished = lastRole === 'assistant' && lastStopReason === 'end_turn'

  if ((streaming || toolDispatched || toolCompleted || userTyping) && ageMs < ACTIVE_MS) {
    status = 'active'
  } else if (claudeFinished) {
    // Claude finished its turn — waiting for user, no time limit
    status = 'waiting'
  } else {
    status = 'idle'
  }

  // needsUserReaction: session needs the user's attention.
  //  • end_turn + explicit question/decision + < 2h
  //  • tool_use + < 3h: tool was dispatched but has no result yet (needs y/n in terminal)
  const NEEDS_RESPONSE_MAX = 2 * 3600_000    // 2h for end_turn sessions
  const STUCK_MAX = 3 * 3600_000             // 3h: after that, consider it abandoned

  // Active time: sum of gaps between consecutive timestamps < 30min
  const ACTIVE_GAP_MS = 30 * 60_000
  let activeTimeMs = 0
  for (let i = 1; i < allTimestamps.length; i++) {
    const gap = allTimestamps[i] - allTimestamps[i - 1]
    if (gap < ACTIVE_GAP_MS) activeTimeMs += gap
  }

  const waitingKind: WaitingKind | undefined = claudeFinished
    ? (looksLikeDecisionNeeded(lastAssistantFullText ?? '') ? 'needs-decision' : 'output-available')
    : undefined

  const needsUserReaction =
    (claudeFinished && waitingKind === 'needs-decision' && ageMs < NEEDS_RESPONSE_MAX) ||
    (toolDispatched && ageMs < STUCK_MAX)

  return {
    cwd,
    gitBranch,
    sessionId,
    version,
    startTime,
    lastActivity,
    status,
    needsUserReaction,
    waitingKind,
    lastTool,
    currentTask,
    lastUserText,
    lastAssistantText,
    tokenUsage,
    toolCallCount,
    tasks: Array.from(tasks.values()),
    contextTokens: lastContextTokens,
    contextLimit: contextLimitForModel(model),
    activeTimeMs,
  }
}

export function parseSubAgent(filePath: string, agentId: string, metaPath: string): SubAgent | null {
  let slug = agentId.slice(0, 8)
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, unknown>
    // meta currently only has agentType
    void meta
  } catch { /* ignore */ }

  const parsed = parseJsonl(filePath)

  // Get slug from first line
  try {
    const firstLine = readFileSync(filePath, 'utf-8').split('\n').find(Boolean)
    if (firstLine) {
      const entry = JSON.parse(firstLine) as Record<string, unknown>
      if (entry.slug) slug = entry.slug as string
    }
  } catch { /* ignore */ }

  if (!parsed.sessionId && !parsed.cwd) return null

  return {
    agentId,
    slug,
    cwd: parsed.cwd,
    gitBranch: parsed.gitBranch,
    startTime: parsed.startTime ?? new Date().toISOString(),
    lastActivity: parsed.lastActivity ?? new Date().toISOString(),
    status: parsed.status,
    needsUserReaction: parsed.needsUserReaction,
    lastTool: parsed.lastTool,
    currentTask: parsed.currentTask,
    lastUserText: parsed.lastUserText,
    lastAssistantText: parsed.lastAssistantText,
    tokenUsage: parsed.tokenUsage,
    toolCallCount: parsed.toolCallCount,
    tasks: parsed.tasks,
    contextTokens: parsed.contextTokens,
    contextLimit: parsed.contextLimit,
    waitingKind: parsed.waitingKind,
    activeTimeMs: parsed.activeTimeMs,
  }
}
