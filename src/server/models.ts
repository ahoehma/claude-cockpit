export type SessionStatus = 'active' | 'waiting' | 'idle' | 'completed'
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

export interface SubAgent {
  agentId: string
  slug: string
  cwd: string
  gitBranch?: string
  startTime: string
  lastActivity: string
  status: SessionStatus
  needsUserReaction: boolean  // Claude finished its turn — user must respond
  currentTool?: ToolCall
  lastTool?: ToolCall
  currentTask?: string
  lastAssistantText?: string
  tokenUsage: TokenUsage
  toolCallCount: number
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
  currentTool?: ToolCall
  lastTool?: ToolCall
  currentTask?: string
  lastAssistantText?: string
  tokenUsage: TokenUsage
  toolCallCount: number
  subAgents: SubAgent[]
}

export interface CockpitState {
  sessions: Session[]
  lastScan: string
  totalActiveSessions: number
  totalSubAgents: number
}
