import { spawn } from 'child_process'

// ── Windows tray icon via PowerShell .NET Forms ───────────────────────────
// No npm dependencies needed — PowerShell + System.Windows.Forms is always
// available on Windows. The script runs hidden and communicates via stdout.

function buildScript(url: string, exePath: string): string {
  // Escape single quotes for PowerShell string literals
  const safeUrl  = url.replace(/'/g, "''")
  const safeExe  = exePath.replace(/'/g, "''")

  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Draw pixel-art bot icon (matches web UI): dark bg, orange blocky body, eye visor
$bmp = New-Object System.Drawing.Bitmap 32, 32
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 15, 23, 42))

$dark   = [System.Drawing.Color]::FromArgb(255, 194,  65,  12)  # #c2410c feet
$mid    = [System.Drawing.Color]::FromArgb(255, 234,  88,  12)  # #ea580c top/bottom
$bright = [System.Drawing.Color]::FromArgb(255, 249, 115,  22)  # #f97316 body

$b_dark   = New-Object System.Drawing.SolidBrush($dark)
$b_mid    = New-Object System.Drawing.SolidBrush($mid)
$b_bright = New-Object System.Drawing.SolidBrush($bright)

# Body rows (scaled from 100px viewBox to 32px: factor ~0.32)
$g.FillRectangle($b_mid,    7,  3, 18,  3)   # top cap
$g.FillRectangle($b_bright, 3,  6, 26,  3)   # row 1
$g.FillRectangle($b_bright, 2,  9, 28,  3)   # row 2
$g.FillRectangle($b_bright, 2, 12, 28,  3)   # row 3 (eye level)
$g.FillRectangle($b_bright, 2, 15, 28,  3)   # row 4
$g.FillRectangle($b_mid,    3, 18, 26,  3)   # bottom taper
$g.FillRectangle($b_dark,   7, 21, 18,  3)   # lower taper
# Feet
$g.FillRectangle($b_dark,   6, 24,  7,  3)
$g.FillRectangle($b_dark,  19, 24,  7,  3)

# Eye visor (dark band)
$visor = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 15, 23, 42))
$g.FillRectangle($visor, 2, 10, 28, 8)
$visor.Dispose()

# Iris (orange rectangle)
$g.FillRectangle($b_bright, 9, 10, 14, 8)
# Pupil
$pupil = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 15, 23, 42))
$g.FillRectangle($pupil, 12, 12, 8, 4)
$pupil.Dispose()

$b_dark.Dispose(); $b_mid.Dispose(); $b_bright.Dispose()
$g.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())

$tray         = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon    = $icon
$tray.Text    = 'Claude Cockpit'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

# ── Open Browser ─────────────────────────────────────────────────
$openItem      = New-Object System.Windows.Forms.ToolStripMenuItem
$openItem.Text = 'Open Claude Cockpit'
$openItem.add_Click({ Start-Process '${safeUrl}' })
$menu.Items.Add($openItem) | Out-Null

$menu.Items.Add('-') | Out-Null

# ── Start with Windows (autostart toggle) ────────────────────────
$regPath  = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
$appName  = 'ClaudeCockpit'
$curVal   = (Get-ItemProperty -Path $regPath -Name $appName -ErrorAction SilentlyContinue).$appName

$autoItem         = New-Object System.Windows.Forms.ToolStripMenuItem
$autoItem.Text    = 'Start with Windows'
$autoItem.Checked = ($null -ne $curVal)
$autoItem.add_Click({
  if ($autoItem.Checked) {
    Remove-ItemProperty -Path $regPath -Name $appName -ErrorAction SilentlyContinue
    $autoItem.Checked = $false
  } else {
    Set-ItemProperty -Path $regPath -Name $appName -Value '"${safeExe}"'
    $autoItem.Checked = $true
  }
})
$menu.Items.Add($autoItem) | Out-Null

$menu.Items.Add('-') | Out-Null

# ── Quit ─────────────────────────────────────────────────────────
$quitItem      = New-Object System.Windows.Forms.ToolStripMenuItem
$quitItem.Text = 'Quit'
$quitItem.add_Click({
  $tray.Visible = $false
  $tray.Dispose()
  [Console]::Out.WriteLine('__QUIT__')
  [Console]::Out.Flush()
  [System.Windows.Forms.Application]::Exit()
})
$menu.Items.Add($quitItem) | Out-Null

$tray.ContextMenuStrip = $menu
$tray.add_DoubleClick({ Start-Process '${safeUrl}' })

[System.Windows.Forms.Application]::Run()
`
}

export function setupTray(url: string): void {
  if (process.platform !== 'win32') {
    // macOS / Linux: tray not yet implemented
    return
  }

  const script = buildScript(url, process.execPath)

  // Pass the script via stdin to avoid command-line length limits
  const ps = spawn('powershell.exe', [
    '-WindowStyle', 'Hidden',
    '-NoProfile',
    '-NonInteractive',
    '-Command', '-',
  ], { stdio: ['pipe', 'pipe', 'pipe'] })

  ps.stdin?.write(script)
  ps.stdin?.end()

  ps.stdout?.on('data', (data: Buffer) => {
    if (data.toString().includes('__QUIT__')) {
      cleanup()
      process.exit(0)
    }
  })

  ps.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    if (msg) console.warn('[tray]', msg)
  })

  // If PowerShell exits for any reason, shut down the server too
  ps.on('exit', () => process.exit(0))

  function cleanup() {
    try { ps.kill() } catch { /* ignore */ }
  }

  process.on('exit', cleanup)
  process.on('SIGINT',  () => { cleanup(); process.exit(0) })
  process.on('SIGTERM', () => { cleanup(); process.exit(0) })

  console.log('[tray] System tray active — right-click the tray icon to quit')
}
