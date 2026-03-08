# Changelog

# [0.4.0](https://github.com/ahoehma/claude-cockpit/compare/v0.3.0...v0.4.0) (2026-03-08)


### Features

* browser notifications, changelog automation, UX fixes ([2463e00](https://github.com/ahoehma/claude-cockpit/commit/2463e002d7f4dd7abdd1f1ca11604b39094df8a7))

## [0.3.0] - 2026-03-08

### Features
- Native executable via `bun build --compile` — single-file binary, no Node.js required
- Windows system tray icon (PowerShell .NET Forms): Open Browser, Start with Windows, Quit
- Pixel-art bot icon inspired by Claude Code terminal mascot (orange + eye visor)
- Browser notifications when an agent needs your response

## [0.2.0] - 2026-03-08

### Features
- Native executable build via `bun build --compile` with embedded frontend assets
- Cross-platform GitHub Actions matrix build (Linux x64, Windows x64, macOS arm64)
- CLI entry point (`npx @ahoehma/claude-cockpit`) via `bin/claude-cockpit.js`

## [0.1.0] - 2026-03-08

### Features
- Live session list with filesystem watching (no polling)
- Status detection: active / waiting / idle based on conversation state
- Sub-agents grouped under parent session with auto-expand
- Needs Response quickfilter — highlights sessions waiting for your input
- Token & cost tracking per session and sub-agent
- Text search, group by project, sort options
- Dark / light theme
- Current action indicator with spinner
- WebSocket push updates
