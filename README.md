# Claude Cockpit

[![CI](https://github.com/ahoehma/claude-cockpit/actions/workflows/ci.yml/badge.svg)](https://github.com/ahoehma/claude-cockpit/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/ahoehma/claude-cockpit)](https://github.com/ahoehma/claude-cockpit/releases/latest)

A local real-time dashboard for monitoring all your [Claude Code](https://claude.ai/code) agent sessions — including sub-agents — from a single browser tab.

Runs entirely on your machine. No cloud, no accounts, no tracking.

---

## Features

- **Live session list** — detects new and updated sessions via filesystem watching (no polling)
- **Status detection** — accurately distinguishes active (tool running), waiting (needs your response), and idle sessions based on conversation state, not just timestamps
- **Sub-agents** — shows sub-agents spawned by Claude Code's Agent tool, grouped under their parent session
- **Needs Response filter** — highlights sessions that are waiting for your confirmation or response right now
- **Token & cost tracking** — per-session and per-sub-agent token counts and estimated USD cost
- **Text search** — filter by project path, branch, task description, or sub-agent slug
- **Group by project** — collapses sessions from the same repo together
- **Sort** — by last event, cost, token count, tool calls, or session age
- **Dark / light theme** — follows your system preference, toggle in the UI
- **Current action indicator** — shows the tool Claude is running right now, with a spinner when active

---

## Requirements

- [Node.js](https://nodejs.org/) 20+
- [Claude Code](https://claude.ai/code) — sessions are read from `~/.claude/projects/`

---

## Getting Started

**Clone and run:**

```bash
git clone https://github.com/ahoehma/claude-cockpit.git
cd claude-cockpit
npm install
npm run dev
```

The dashboard opens automatically in your browser. The server watches `~/.claude/projects/` for changes and pushes updates via WebSocket — no manual refresh needed.

---

## How It Works

Claude Code stores every session as a `.jsonl` file under `~/.claude/projects/<encoded-path>/<session-id>.jsonl`. Each line is a JSON message (user, assistant, tool calls, usage stats).

Claude Cockpit watches that directory with [chokidar](https://github.com/paulmillr/chokidar), parses the JSONL files on change, and streams the current state to the browser over WebSocket.

**Status detection** is based on the last message's `stop_reason` and role:

| Condition | Status |
|-----------|--------|
| Tool dispatched, result pending, age < 10 min | `active` |
| User just sent a message, Claude processing | `active` |
| `stop_reason: end_turn`, age < 2h | `waiting` (needs response) |
| Tool dispatched, no result yet | `needs response` |
| Everything else | `idle` / `done` |

---

## Project Structure

```
src/
  server/
    index.ts       HTTP + WebSocket server, filesystem watcher
    scanner.ts     Scans ~/.claude/projects/, builds session list
    parser.ts      Parses .jsonl files into typed Session objects
    models.ts      TypeScript types
  client/
    src/
      App.vue                  Main layout, filters, sorting, grouping
      components/
        AgentCard.vue          Session / sub-agent card
        SubAgentSection.vue    Collapsible sub-agent list
      useWebSocket.ts          WebSocket state management
      useNow.ts                Shared reactive clock
      useTheme.ts              Dark/light theme
vite.config.ts                 Vite config, proxies /api and /ws to backend
```

---

## Stack

- **Backend**: Node.js + TypeScript ([tsx](https://github.com/privatenumber/tsx)), [ws](https://github.com/websockets/ws), [chokidar](https://github.com/paulmillr/chokidar)
- **Frontend**: [Vue 3](https://vuejs.org/), [Vite](https://vitejs.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [lucide-vue-next](https://lucide.dev/)

---

## Scripts

```bash
npm run dev        # Start backend + frontend in dev mode (hot reload)
npm run build      # Build frontend to dist/client/
npm start          # Start backend only (serves built frontend)
```

---

## License

MIT
