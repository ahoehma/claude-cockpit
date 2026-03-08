import { readdirSync, existsSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parseJsonl, parseSubAgent } from './parser.ts'
import type { Session, CockpitState, IntegrationMode } from './models.ts'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json')

function decodeProjectPath(encoded: string): string {
  // ~/.claude/projects encodes paths like: D--Dev-git-privat-cmux
  // We try to reconstruct a human-readable path
  return encoded
    .replace(/^([A-Z])--/, '$1:\\')   // Windows drive letter
    .replace(/--/g, '/')              // separators back to slashes
    .replace(/\\/g, '/')              // normalize
}

function getProjectLabel(encoded: string): string {
  // Last segment = project name
  const decoded = decodeProjectPath(encoded)
  const parts = decoded.split('/')
  return parts[parts.length - 1] || encoded
}

function detectIntegrationMode(projectDir: string): IntegrationMode {
  // Check if cockpit hooks are configured
  const localSettings = join(projectDir, '.claude', 'settings.json')
  const paths = [CLAUDE_SETTINGS_PATH, localSettings]

  for (const p of paths) {
    if (!existsSync(p)) continue
    try {
      const s = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>
      const hooks = s.hooks as Record<string, unknown> | undefined
      if (hooks) {
        // Check if any hook points to cockpit
        const hookStr = JSON.stringify(hooks)
        if (hookStr.includes('cockpit') || hookStr.includes('claude-cockpit')) {
          return 'hooks'
        }
      }
    } catch { /* ignore */ }
  }
  return 'watching'
}

export function scanAllSessions(): CockpitState {
  const sessions: Session[] = []

  if (!existsSync(CLAUDE_PROJECTS_DIR)) {
    return { sessions: [], lastScan: new Date().toISOString(), totalActiveSessions: 0, totalSubAgents: 0 }
  }

  let projectDirs: string[]
  try {
    projectDirs = readdirSync(CLAUDE_PROJECTS_DIR)
  } catch {
    return { sessions: [], lastScan: new Date().toISOString(), totalActiveSessions: 0, totalSubAgents: 0 }
  }

  for (const projectEncoded of projectDirs) {
    const projectPath = join(CLAUDE_PROJECTS_DIR, projectEncoded)

    let entries: string[]
    try {
      entries = readdirSync(projectPath)
    } catch {
      continue
    }

    // Find all .jsonl files (sessions)
    const jsonlFiles = entries.filter(e => e.endsWith('.jsonl'))

    for (const jsonlFile of jsonlFiles) {
      const sessionId = jsonlFile.replace('.jsonl', '')
      const jsonlPath = join(projectPath, jsonlFile)

      // Skip very small files (< 100 bytes = likely empty/broken)
      try {
        const stat = statSync(jsonlPath)
        if (stat.size < 50) continue
      } catch {
        continue
      }

      const parsed = parseJsonl(jsonlPath)
      if (!parsed.cwd) continue

      // Check for sub-agents directory
      const subAgentsDir = join(projectPath, sessionId, 'subagents')
      const subAgents = []

      if (existsSync(subAgentsDir)) {
        let subEntries: string[]
        try {
          subEntries = readdirSync(subAgentsDir)
        } catch {
          subEntries = []
        }

        const metaFiles = subEntries.filter(e => e.endsWith('.meta.json'))
        for (const metaFile of metaFiles) {
          const agentId = metaFile.replace('.meta.json', '').replace('agent-', '')
          const agentJsonl = join(subAgentsDir, `agent-${agentId}.jsonl`)
          const agentMeta = join(subAgentsDir, metaFile)

          if (!existsSync(agentJsonl)) continue

          const subAgent = parseSubAgent(agentJsonl, agentId, agentMeta)
          if (subAgent) {
            // Sub-agents can't receive direct user input — 'waiting' means they finished
            subAgent.needsUserReaction = false
            if (subAgent.status === 'waiting') subAgent.status = 'completed'
            subAgents.push(subAgent)
          }
        }
      }

      const decodedPath = decodeProjectPath(projectEncoded)

      const session: Session = {
        sessionId,
        projectDir: projectEncoded,
        projectPath: decodedPath,
        cwd: parsed.cwd,
        gitBranch: parsed.gitBranch,
        claudeVersion: parsed.version,
        startTime: parsed.startTime ?? new Date().toISOString(),
        lastActivity: parsed.lastActivity ?? new Date().toISOString(),
        status: parsed.status,
        integrationMode: detectIntegrationMode(parsed.cwd),
        currentTool: parsed.currentTool,
        needsUserReaction: parsed.needsUserReaction,
        lastTool: parsed.lastTool,
        currentTask: parsed.currentTask,
        lastAssistantText: parsed.lastAssistantText,
        tokenUsage: parsed.tokenUsage,
        toolCallCount: parsed.toolCallCount,
        tasks: parsed.tasks,
        subAgents,
      }

      sessions.push(session)
    }
  }

  // Sort: active first, then by lastActivity desc
  sessions.sort((a, b) => {
    const statusOrder = { active: 0, waiting: 1, idle: 2, completed: 3 }
    const so = statusOrder[a.status] - statusOrder[b.status]
    if (so !== 0) return so
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  })

  const totalSubAgents = sessions.reduce((acc, s) => acc + s.subAgents.length, 0)
  const totalActiveSessions = sessions.filter(s => s.status === 'active' || s.status === 'waiting').length

  return {
    sessions,
    lastScan: new Date().toISOString(),
    totalActiveSessions,
    totalSubAgents,
  }
}
