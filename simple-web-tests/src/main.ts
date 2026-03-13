import { createWallet, type BrowserWallet } from '@bsv/simple/browser'
import { log, clearLog } from './logger'
import {
  testWalletInfo,
  testPushDropCreate, testPushDropList, testPushDropSend, testPushDropRedeem,
  testOrdinalInscribe, testOrdinalList, testOrdinalTransfer, testOrdinalBurn,
  testBsv21Deploy, testBsv21List, testBsv21Transfer, testBsv21Burn,
  testBsv20Deploy, testBsv20Mint, testBsv20List, testBsv20Transfer, testBsv20Burn,
  testMarketListForSale, testMarketPurchase, testMarketCancel,
  testUnifiedMint, testUnifiedList, testUnifiedTransfer, testUnifiedBurn,
  runAllTests
} from './tests'

let wallet: BrowserWallet | null = null

function $(id: string) {
  return document.getElementById(id)!
}

// Map test button data-test attribute to test function
const testMap: Record<string, (w: BrowserWallet) => Promise<any>> = {
  'pushdrop-create': testPushDropCreate,
  'pushdrop-list': testPushDropList,
  'pushdrop-send': testPushDropSend,
  'pushdrop-redeem': testPushDropRedeem,
  'ordinal-inscribe': testOrdinalInscribe,
  'ordinal-list': testOrdinalList,
  'ordinal-transfer': testOrdinalTransfer,
  'ordinal-burn': testOrdinalBurn,
  'bsv21-deploy': testBsv21Deploy,
  'bsv21-list': testBsv21List,
  'bsv21-transfer': testBsv21Transfer,
  'bsv21-burn': testBsv21Burn,
  'bsv20-deploy': testBsv20Deploy,
  'bsv20-mint': testBsv20Mint,
  'bsv20-list': testBsv20List,
  'bsv20-transfer': testBsv20Transfer,
  'bsv20-burn': testBsv20Burn,
  'market-list-sale': testMarketListForSale,
  'market-purchase': testMarketPurchase,
  'market-cancel': testMarketCancel,
  'unified-mint': testUnifiedMint,
  'unified-list': testUnifiedList,
  'unified-transfer': testUnifiedTransfer,
  'unified-burn': testUnifiedBurn,
}

// ============================================================================
// Panel Navigation
// ============================================================================

function setupNavigation() {
  const sidebarButtons = document.querySelectorAll<HTMLButtonElement>('.sidebar button[data-panel]')
  const panels = document.querySelectorAll<HTMLDivElement>('.test-panel')

  sidebarButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const panelId = btn.dataset.panel
      if (!panelId) return

      // Update active sidebar button
      sidebarButtons.forEach(b => b.classList.remove('active'))
      btn.classList.add('active')

      // Show target panel
      panels.forEach(p => p.classList.remove('active'))
      const panel = $(`panel-${panelId}`)
      if (panel) panel.classList.add('active')
    })
  })
}

// ============================================================================
// Wallet Connection
// ============================================================================

async function connectWallet() {
  const btn = $('btn-connect') as HTMLButtonElement
  const statusEl = $('wallet-status')
  const statusText = $('wallet-status-text')

  btn.disabled = true
  btn.textContent = 'Connecting...'
  log('info', 'Connecting wallet via createWallet()...')

  try {
    wallet = await createWallet()

    const identityKey = wallet.getIdentityKey()
    statusEl.classList.add('connected')
    statusText.textContent = `${identityKey.substring(0, 10)}...${identityKey.substring(identityKey.length - 6)}`

    btn.textContent = 'Connected'
    btn.style.borderColor = 'var(--green)'
    btn.style.color = 'var(--green)'

    // Enable all test buttons
    document.querySelectorAll<HTMLButtonElement>('[data-test], #btn-get-info').forEach(b => {
      b.disabled = false
    })

    // Show run all button
    const runAllBtn = $('btn-run-all') as HTMLButtonElement
    runAllBtn.style.display = 'block'

    log('success', 'Wallet connected', `Key: ${identityKey}`)
  } catch (err: any) {
    btn.disabled = false
    btn.textContent = 'Connect Wallet'
    log('error', 'Failed to connect wallet', err?.message ?? String(err))
  }
}

// ============================================================================
// Test Button Handlers
// ============================================================================

function setupTestButtons() {
  // Individual test buttons
  document.querySelectorAll<HTMLButtonElement>('[data-test]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!wallet) return
      const testName = btn.dataset.test!
      const testFn = testMap[testName]
      if (!testFn) return

      btn.disabled = true
      try {
        await testFn(wallet)
      } catch {
        // Already logged
      }
      btn.disabled = false
    })
  })

  // Wallet info button
  $('btn-get-info')?.addEventListener('click', async () => {
    if (!wallet) return
    const btn = $('btn-get-info') as HTMLButtonElement
    btn.disabled = true
    try { await testWalletInfo(wallet) } catch {}
    btn.disabled = false
  })
}

// ============================================================================
// Run All Tests
// ============================================================================

function setupRunAll() {
  const btn = $('btn-run-all') as HTMLButtonElement
  const progressBar = document.querySelector<HTMLDivElement>('.progress')!
  const progressFill = $('progress-fill') as HTMLDivElement

  btn.addEventListener('click', async () => {
    if (!wallet) return
    btn.disabled = true
    progressBar.style.display = 'block'
    progressFill.style.width = '0%'

    await runAllTests(wallet, (pct) => {
      progressFill.style.width = `${pct}%`
    })

    btn.disabled = false
    setTimeout(() => { progressBar.style.display = 'none' }, 2000)
  })
}

// ============================================================================
// Init
// ============================================================================

function init() {
  log('info', '@bsv/simple Token Standards Test Suite loaded')
  log('info', 'Click "Connect Wallet" to begin testing')

  setupNavigation()
  setupTestButtons()
  setupRunAll()

  $('btn-connect')!.addEventListener('click', connectWallet)
  $('btn-clear-log')!.addEventListener('click', clearLog)
}

document.addEventListener('DOMContentLoaded', init)
