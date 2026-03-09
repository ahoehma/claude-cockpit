# Changelog

# [0.9.0](https://github.com/ahoehma/claude-cockpit/compare/v0.8.1...v0.9.0) (2026-03-09)


### Bug Fixes

* show sessions with active sub-agents in active filter ([6a26af4](https://github.com/ahoehma/claude-cockpit/commit/6a26af4d454e78069c527ba2cceb3012008a2979))


### Features

* individually expand/collapse sub-agents in compact list view ([80d0889](https://github.com/ahoehma/claude-cockpit/commit/80d088932e81b5b5703e282ae3b0d1f1239250ba))

## [0.8.1](https://github.com/ahoehma/claude-cockpit/compare/v0.8.0...v0.8.1) (2026-03-08)


### Bug Fixes

* smooth theme transition, scrollbar in content area, visible scrollbar in light mode ([6c9b82b](https://github.com/ahoehma/claude-cockpit/commit/6c9b82bd7befd02cbdeb20324c412eeeb868229f))

# [0.8.0](https://github.com/ahoehma/claude-cockpit/compare/v0.7.1...v0.8.0) (2026-03-08)


### Features

* add cockpit view with 3D flip transition and group sort fix ([b9e504a](https://github.com/ahoehma/claude-cockpit/commit/b9e504a867585673bb87da2fec41f63933b2243c))

## [0.7.1](https://github.com/ahoehma/claude-cockpit/compare/v0.7.0...v0.7.1) (2026-03-08)


### Features

* add Current/Last prompt label to exchange block in AgentCard ([931692e](https://github.com/ahoehma/claude-cockpit/commit/931692ebea9f3c8b1a45a299918569e79b459479))

# [0.7.0](https://github.com/ahoehma/claude-cockpit/compare/v0.6.0...v0.7.0) (2026-03-08)


### Features

* UX overhaul, context tracking, smart waiting states ([5bf7f03](https://github.com/ahoehma/claude-cockpit/commit/5bf7f03cbb41685ec63baf04ad90252b335a9982))

# [0.6.0](https://github.com/ahoehma/claude-cockpit/compare/v0.4.0...v0.6.0) (2026-03-08)


### Features

* task tracking, sub-agent expand levels, UX fixes ([83cc55e](https://github.com/ahoehma/claude-cockpit/commit/83cc55e5f1f96daddf113c13535884794a740b23))

# [0.5.0](https://github.com/ahoehma/claude-cockpit/compare/v0.4.0...v0.5.0) (2026-03-08)


### Features

* task tracking, sub-agent expand levels, UX fixes ([83cc55e](https://github.com/ahoehma/claude-cockpit/commit/83cc55e5f1f96daddf113c13535884794a740b23))

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
