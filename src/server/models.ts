export type SessionStatus = 'active' | 'waiting' | 'idle' | 'completed'
export type WaitingKind = 'needs-decision' | 'output-available'
export type IntegrationMode = 'hooks' | 'watching' | 'polling'

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  estimatedCostUsd: number
}

export interface ToolCall {
  name: string
  input: Record<string, unknown>
  timestamp: string
  result?: string
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface AgentTask {
  id: string          // numeric string returned by TaskCreate result ("1", "2", ...)
  subject: string
  activeForm?: string // short label shown while in_progress
  status: TaskStatus
}

export interface SubAgent {
  agentId: string
  slug: string
  cwd: string
  gitBranch?: string
  startTime: string
  lastActivity: string
  status: SessionStatus
  needsUserReaction: boolean
  waitingKind?: WaitingKind
  currentTool?: ToolCall
  lastTool?: ToolCall
  currentTask?: string
  lastUserText?: string
  lastAssistantText?: string
  tokenUsage: TokenUsage
  toolCallCount: number
  tasks: AgentTask[]
  contextTokens?: number
  contextLimit: number
  activeTimeMs: number
}

export interface Session {
  sessionId: string
  projectDir: string   // encoded directory name under ~/.claude/projects/
  projectPath: string  // decoded human-readable path
  cwd: string
  gitBranch?: string
  claudeVersion?: string
  startTime: string
  lastActivity: string
  status: SessionStatus
  integrationMode: IntegrationMode
  needsUserReaction: boolean  // Claude finished its turn — user must respond
  waitingKind?: WaitingKind  // 'needs-decision' = explicit question/tool confirm, 'output-available' = just finished output
  currentTool?: ToolCall
  lastTool?: ToolCall
  currentTask?: string
  lastUserText?: string
  lastAssistantText?: string
  tokenUsage: TokenUsage
  toolCallCount: number
  tasks: AgentTask[]
  subAgents: SubAgent[]
  contextTokens?: number
  contextLimit: number
  activeTimeMs: number
}

export interface CockpitState {
  sessions: Session[]
  lastScan: string
  totalActiveSessions: number
  totalSubAgents: number
}
