import { readFileSync } from 'fs'
import type { Session, SubAgent, TokenUsage, ToolCall, SessionStatus } from './models.ts'

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
  tokenUsage: TokenUsage
  toolCallCount: number
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
  let lastAssistantText: string | undefined
  // For status detection
  let lastRole: 'user' | 'assistant' | undefined
  let lastStopReason: string | null = null
  let lastMsgHasToolResult = false
  let lastMsgHasToolUse = false

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

    if (ts) lastActivity = ts

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
            lastTool = {
              name: block.name as string,
              input: (block.input ?? {}) as Record<string, unknown>,
              timestamp: ts ?? new Date().toISOString(),
            }
          }
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            textParts.push(block.text.trim())
          }
        }
        if (textParts.length > 0) {
          lastAssistantText = textParts.join('\n\n')
        }
      }

      // Accumulate token usage — use only top-level cache_creation_input_tokens.
      // The nested cache_creation.ephemeral_* fields are the same values broken out,
      // so we must NOT add both or we double-count.
      const u = msg.usage as Record<string, unknown> | undefined
      if (u) {
        usage.inputTokens        += (u.input_tokens as number) || 0
        usage.outputTokens       += (u.output_tokens as number) || 0
        usage.cacheCreationTokens += (u.cache_creation_input_tokens as number) || 0
        usage.cacheReadTokens    += (u.cache_read_input_tokens as number) || 0
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
  //  • end_turn + < 2h: Claude finished and is waiting for a response
  //  • tool_use + < 3h: tool was dispatched but has no result yet
  //    → no minimum delay: tool confirmations need immediate attention
  //      (user may need to type y/n in terminal right now)
  const NEEDS_RESPONSE_MAX = 2 * 3600_000    // 2h for end_turn sessions
  const STUCK_MAX = 3 * 3600_000             // 3h: after that, consider it abandoned

  const needsUserReaction =
    (claudeFinished && ageMs < NEEDS_RESPONSE_MAX) ||
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
    lastTool,
    currentTask,
    lastAssistantText,
    tokenUsage,
    toolCallCount,
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
    lastAssistantText: parsed.lastAssistantText,
    tokenUsage: parsed.tokenUsage,
    toolCallCount: parsed.toolCallCount,
  }
}
