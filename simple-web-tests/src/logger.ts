// Event log and stats tracking

export type LogLevel = 'info' | 'success' | 'error' | 'warn' | 'tx'

interface LogEntry {
  level: LogLevel
  message: string
  detail?: string
  timestamp: Date
}

const entries: LogEntry[] = []
let totalTests = 0
let passTests = 0
let failTests = 0
let totalTimeMs = 0

function getEl<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

export function log(level: LogLevel, message: string, detail?: string) {
  const entry: LogEntry = { level, message, detail, timestamp: new Date() }
  entries.push(entry)
  renderLogEntry(entry)
}

function renderLogEntry(entry: LogEntry) {
  const container = getEl<HTMLDivElement>('log-entries')
  const div = document.createElement('div')
  div.className = `log-entry ${entry.level}`

  const time = entry.timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const ms = String(entry.timestamp.getMilliseconds()).padStart(3, '0')

  let html = `<span class="timestamp">${time}.${ms}</span>${escapeHtml(entry.message)}`
  if (entry.detail) {
    html += `<span class="detail">${escapeHtml(entry.detail)}</span>`
  }
  div.innerHTML = html
  container.appendChild(div)
  container.scrollTop = container.scrollHeight
}

export function recordTestResult(passed: boolean, durationMs: number) {
  totalTests++
  if (passed) passTests++
  else failTests++
  totalTimeMs += durationMs
  updateStats()
}

function updateStats() {
  getEl('stat-total').textContent = String(totalTests)
  getEl('stat-pass').textContent = String(passTests)
  getEl('stat-fail').textContent = String(failTests)
  getEl('stat-time').textContent = totalTimeMs < 1000 ? `${totalTimeMs}ms` : `${(totalTimeMs / 1000).toFixed(1)}s`
}

export function clearLog() {
  entries.length = 0
  totalTests = 0
  passTests = 0
  failTests = 0
  totalTimeMs = 0
  getEl('log-entries').innerHTML = ''
  updateStats()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderResult(containerId: string, opts: {
  title: string
  status: 'pass' | 'fail' | 'running'
  duration?: number
  data?: any
  error?: string
}) {
  const container = getEl<HTMLDivElement>(containerId)
  const card = document.createElement('div')
  card.className = 'result-card'

  const statusLabel = opts.status === 'pass' ? 'PASS' : opts.status === 'fail' ? 'FAIL' : 'RUNNING...'
  const timing = opts.duration != null ? `${opts.duration}ms` : ''

  let bodyHtml = ''
  if (opts.error) {
    bodyHtml = `<pre style="color: var(--red)">${escapeHtml(opts.error)}</pre>`
  } else if (opts.data !== undefined) {
    bodyHtml = `<pre>${escapeHtml(typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data, null, 2))}</pre>`
  }

  card.innerHTML = `
    <div class="card-header">
      <span>${escapeHtml(opts.title)}</span>
      <span>
        ${timing ? `<span class="timing">${timing}</span> ` : ''}
        <span class="status ${opts.status}">${statusLabel}</span>
      </span>
    </div>
    ${bodyHtml ? `<div class="card-body">${bodyHtml}</div>` : ''}
  `
  container.prepend(card)
}

export function updateSidebarBadge(panelId: string, status: 'pass' | 'fail' | 'running') {
  const btn = document.querySelector(`[data-panel="${panelId}"]`)
  if (!btn) return
  let badge = btn.querySelector('.badge')
  if (!badge) {
    badge = document.createElement('span')
    badge.className = 'badge'
    btn.appendChild(badge)
  }
  badge.className = `badge ${status}`
  badge.textContent = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : '...'
}
