#!/usr/bin/env node
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const server = join(root, 'src', 'server', 'index.ts')
const distIndex = join(root, 'dist', 'client', 'index.html')
const tsx = join(root, 'node_modules', '.bin', 'tsx')

// Build the frontend if it hasn't been built yet
if (!existsSync(distIndex)) {
  console.log('Building frontend (first run)...')
  execSync('npm run build', { cwd: root, stdio: 'inherit' })
}

spawn(tsx, [server], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } })
