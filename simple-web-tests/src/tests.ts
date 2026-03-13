// Test implementations for all token standards
import type { BrowserWallet } from '@bsv/simple/browser'
import { log, renderResult, recordTestResult, updateSidebarBadge } from './logger'

type Wallet = BrowserWallet

// Shared state for cross-test data
export const state: Record<string, any> = {}

function getVal(id: string): string {
  return (document.getElementById(id) as HTMLInputElement)?.value ?? ''
}

function setVal(id: string, val: string) {
  const el = document.getElementById(id) as HTMLInputElement
  if (el) el.value = val
}

// Generic test runner
async function runTest(
  panelId: string,
  resultId: string,
  title: string,
  fn: () => Promise<any>
) {
  log('info', `Starting: ${title}`)
  updateSidebarBadge(panelId, 'running')
  renderResult(resultId, { title, status: 'running' })

  const start = performance.now()
  try {
    const result = await fn()
    const duration = Math.round(performance.now() - start)

    log('success', `PASS: ${title}`, `${duration}ms`)
    if (result?.txid) {
      log('tx', `TXID: ${result.txid}`)
    }
    renderResult(resultId, { title, status: 'pass', duration, data: result })
    updateSidebarBadge(panelId, 'pass')
    recordTestResult(true, duration)
    return result
  } catch (err: any) {
    const duration = Math.round(performance.now() - start)
    const msg = err?.message ?? String(err)
    log('error', `FAIL: ${title}`, msg)
    renderResult(resultId, { title, status: 'fail', duration, error: msg })
    updateSidebarBadge(panelId, 'fail')
    recordTestResult(false, duration)
    throw err
  }
}

// ============================================================================
// Wallet Info
// ============================================================================

export async function testWalletInfo(wallet: Wallet) {
  return runTest('wallet-info', 'result-wallet-info', 'Get Wallet Info', async () => {
    const identityKey = wallet.getIdentityKey()
    const address = wallet.getAddress()
    const status = await wallet.getStatus()
    const info = await wallet.getWalletInfo()

    log('info', `Identity Key: ${identityKey.substring(0, 20)}...`)
    log('info', `Address: ${address}`)
    log('info', `Network: ${status.network}`)

    return { identityKey, address, ...status, ...info }
  })
}

// ============================================================================
// PushDrop Tests
// ============================================================================

export async function testPushDropCreate(wallet: Wallet) {
  return runTest('pushdrop-create', 'result-pushdrop-create', 'PushDrop: createToken()', async () => {
    const data = JSON.parse(getVal('pd-create-data'))
    const basket = getVal('pd-create-basket')
    const satoshis = parseInt(getVal('pd-create-sats')) || 1

    const result = await wallet.createToken({ data, basket, satoshis })

    state.lastPushDropTxid = result.txid
    log('tx', `Created PushDrop token in basket "${basket}"`, `txid: ${result.txid}`)
    return result
  })
}

export async function testPushDropList(wallet: Wallet) {
  return runTest('pushdrop-list', 'result-pushdrop-list', 'PushDrop: listTokenDetails()', async () => {
    const basket = getVal('pd-list-basket')
    const tokens = await wallet.listTokenDetails(basket)

    log('info', `Found ${tokens.length} PushDrop tokens in "${basket}"`)
    if (tokens.length > 0) {
      state.lastPushDropOutpoint = tokens[0].outpoint
      setVal('pd-send-outpoint', tokens[0].outpoint)
      setVal('pd-redeem-outpoint', tokens[0].outpoint)
    }

    return {
      count: tokens.length,
      tokens: tokens.map(t => ({
        outpoint: t.outpoint,
        satoshis: t.satoshis,
        data: t.data,
        protocolID: t.protocolID,
        keyID: t.keyID,
        counterparty: t.counterparty
      }))
    }
  })
}

export async function testPushDropSend(wallet: Wallet) {
  return runTest('pushdrop-send', 'result-pushdrop-send', 'PushDrop: sendToken()', async () => {
    const basket = getVal('pd-send-basket')
    const outpoint = getVal('pd-send-outpoint')
    const to = getVal('pd-send-to') || wallet.getIdentityKey()

    if (!outpoint) throw new Error('No outpoint specified. Create and list tokens first.')

    const result = await wallet.sendToken({ basket, outpoint, to })
    log('tx', `Sent PushDrop token to ${to.substring(0, 20)}...`)
    return result
  })
}

export async function testPushDropRedeem(wallet: Wallet) {
  return runTest('pushdrop-redeem', 'result-pushdrop-redeem', 'PushDrop: redeemToken()', async () => {
    const basket = getVal('pd-redeem-basket')
    const outpoint = getVal('pd-redeem-outpoint')

    if (!outpoint) throw new Error('No outpoint specified. Create and list tokens first.')

    const result = await wallet.redeemToken({ basket, outpoint })
    log('tx', 'Redeemed PushDrop token')
    return result
  })
}

// ============================================================================
// Ordinal Tests
// ============================================================================

export async function testOrdinalInscribe(wallet: Wallet) {
  return runTest('ordinal-inscribe', 'result-ordinal-inscribe', 'Ordinal: inscribeOrdinal()', async () => {
    const content = getVal('ord-inscribe-content')
    const contentType = getVal('ord-inscribe-type')
    let metadata: any = undefined
    const metaStr = getVal('ord-inscribe-meta').trim()
    if (metaStr) {
      metadata = JSON.parse(metaStr)
    }

    const result = await wallet.inscribeOrdinal({
      content,
      contentType,
      metadata
    })

    state.lastOrdinalTxid = result.txid
    log('tx', `Inscribed ordinal: ${contentType}`, `txid: ${result.txid}`)
    return { txid: result.txid, standard: result.standard, basket: result.basket }
  })
}

export async function testOrdinalList(wallet: Wallet) {
  return runTest('ordinal-list', 'result-ordinal-list', 'Ordinal: listTokens({standard: "ordinal"})', async () => {
    const basket = getVal('ord-list-basket') || undefined
    const tokens = await wallet.listTokens({ standard: 'ordinal', basket })

    log('info', `Found ${tokens.length} ordinals`)
    if (tokens.length > 0) {
      const first = tokens[0]
      state.lastOrdinalOutpoint = first.outpoint
      setVal('ord-transfer-outpoint', first.outpoint)
      setVal('ord-burn-outpoint', first.outpoint)
      setVal('mkt-list-outpoint', first.outpoint)
    }

    return {
      count: tokens.length,
      tokens: tokens.map(t => ({
        outpoint: t.outpoint,
        satoshis: t.satoshis,
        standard: t.standard,
        ...(t.standard === 'ordinal' ? { contentType: (t as any).contentType } : {})
      }))
    }
  })
}

export async function testOrdinalTransfer(wallet: Wallet) {
  return runTest('ordinal-transfer', 'result-ordinal-transfer', 'Ordinal: transferToken()', async () => {
    const outpoint = getVal('ord-transfer-outpoint')
    const to = getVal('ord-transfer-to') || wallet.getIdentityKey()

    if (!outpoint) throw new Error('No outpoint. Inscribe and list ordinals first.')

    const result = await wallet.transferToken({
      basket: 'ordinals',
      outpoint,
      to,
      standard: 'ordinal'
    })

    log('tx', `Transferred ordinal to ${to.substring(0, 20)}...`)
    return result
  })
}

export async function testOrdinalBurn(wallet: Wallet) {
  return runTest('ordinal-burn', 'result-ordinal-burn', 'Ordinal: burnToken()', async () => {
    const outpoint = getVal('ord-burn-outpoint')
    if (!outpoint) throw new Error('No outpoint. Inscribe and list ordinals first.')

    const result = await wallet.burnToken({
      basket: 'ordinals',
      outpoint,
      standard: 'ordinal'
    })

    log('tx', 'Burned ordinal')
    return result
  })
}

// ============================================================================
// BSV-21 Tests
// ============================================================================

export async function testBsv21Deploy(wallet: Wallet) {
  return runTest('bsv21-deploy', 'result-bsv21-deploy', 'BSV-21: deployBsv21()', async () => {
    const symbol = getVal('b21-deploy-symbol')
    const amount = parseInt(getVal('b21-deploy-amount'))
    const decimals = parseInt(getVal('b21-deploy-decimals'))

    const result = await wallet.deployBsv21({
      op: 'deploy+mint',
      amount,
      symbol,
      decimals
    })

    state.lastBsv21TokenId = result.tokenId
    state.lastBsv21Txid = result.txid
    if (result.tokenId) {
      setVal('b21-transfer-tokenid', result.tokenId)
    }

    log('tx', `Deployed BSV-21: ${symbol}`, `tokenId: ${result.tokenId}`)
    return { txid: result.txid, standard: result.standard, basket: result.basket, tokenId: result.tokenId }
  })
}

export async function testBsv21List(wallet: Wallet) {
  return runTest('bsv21-list', 'result-bsv21-list', 'BSV-21: listTokens({standard: "bsv-21"})', async () => {
    const tokens = await wallet.listTokens({ standard: 'bsv-21' })

    log('info', `Found ${tokens.length} BSV-21 tokens`)
    if (tokens.length > 0) {
      state.lastBsv21Outpoint = tokens[0].outpoint
      setVal('b21-burn-outpoint', tokens[0].outpoint)
    }

    return {
      count: tokens.length,
      tokens: tokens.map(t => ({
        outpoint: t.outpoint,
        standard: t.standard,
        ...(t.standard === 'bsv-21' ? {
          op: (t as any).op,
          tokenId: (t as any).tokenId,
          amount: (t as any).amount,
          symbol: (t as any).symbol
        } : {})
      }))
    }
  })
}

export async function testBsv21Transfer(wallet: Wallet) {
  return runTest('bsv21-transfer', 'result-bsv21-transfer', 'BSV-21: transferBsv21()', async () => {
    const tokenId = getVal('b21-transfer-tokenid')
    const to = getVal('b21-transfer-to') || wallet.getIdentityKey()
    const amount = parseInt(getVal('b21-transfer-amount'))

    if (!tokenId) throw new Error('No tokenId. Deploy a BSV-21 token first.')

    const result = await wallet.transferBsv21({
      op: 'transfer',
      tokenId,
      recipients: [{ to, amount }]
    })

    log('tx', `Transferred ${amount} BSV-21 tokens`)
    return { txid: result.txid, standard: result.standard }
  })
}

export async function testBsv21Burn(wallet: Wallet) {
  return runTest('bsv21-burn', 'result-bsv21-burn', 'BSV-21: burnToken()', async () => {
    const outpoint = getVal('b21-burn-outpoint')
    if (!outpoint) throw new Error('No outpoint. Deploy and list BSV-21 tokens first.')

    const result = await wallet.burnToken({
      basket: 'bsv21-tokens',
      outpoint,
      standard: 'bsv-21'
    })

    log('tx', 'Burned BSV-21 token')
    return result
  })
}

// ============================================================================
// BSV-20 Tests
// ============================================================================

export async function testBsv20Deploy(wallet: Wallet) {
  return runTest('bsv20-deploy', 'result-bsv20-deploy', 'BSV-20: deployBsv20()', async () => {
    const ticker = getVal('b20-deploy-ticker')
    const maxSupply = parseInt(getVal('b20-deploy-max'))
    const mintLimit = parseInt(getVal('b20-deploy-limit')) || undefined
    const decimals = parseInt(getVal('b20-deploy-decimals'))

    const result = await wallet.deployBsv20({
      op: 'deploy',
      ticker,
      maxSupply,
      mintLimit,
      decimals
    })

    state.lastBsv20Txid = result.txid
    state.lastBsv20TokenId = `${result.txid}.0`
    setVal('b20-transfer-tokenid', `${result.txid}.0`)

    log('tx', `Deployed BSV-20: ${ticker}`, `maxSupply: ${maxSupply}`)
    return { txid: result.txid, standard: result.standard, basket: result.basket }
  })
}

export async function testBsv20Mint(wallet: Wallet) {
  return runTest('bsv20-mint', 'result-bsv20-mint', 'BSV-20: mintBsv20()', async () => {
    const ticker = getVal('b20-mint-ticker')
    const amount = parseInt(getVal('b20-mint-amount'))

    const result = await wallet.mintBsv20({
      op: 'mint',
      ticker,
      amount
    })

    state.lastBsv20MintTxid = result.txid
    log('tx', `Minted ${amount} ${ticker}`)
    return { txid: result.txid, standard: result.standard, basket: result.basket }
  })
}

export async function testBsv20List(wallet: Wallet) {
  return runTest('bsv20-list', 'result-bsv20-list', 'BSV-20: listTokens({standard: "bsv-20"})', async () => {
    const tokens = await wallet.listTokens({ standard: 'bsv-20' })

    log('info', `Found ${tokens.length} BSV-20 tokens`)
    if (tokens.length > 0) {
      state.lastBsv20Outpoint = tokens[0].outpoint
      setVal('b20-burn-outpoint', tokens[0].outpoint)
    }

    return {
      count: tokens.length,
      tokens: tokens.map(t => ({
        outpoint: t.outpoint,
        standard: t.standard,
        ...(t.standard === 'bsv-20' ? {
          op: (t as any).op,
          ticker: (t as any).ticker,
          amount: (t as any).amount
        } : {})
      }))
    }
  })
}

export async function testBsv20Transfer(wallet: Wallet) {
  return runTest('bsv20-transfer', 'result-bsv20-transfer', 'BSV-20: transferBsv20()', async () => {
    const ticker = getVal('b20-transfer-ticker')
    const tokenId = getVal('b20-transfer-tokenid')
    const to = getVal('b20-transfer-to') || wallet.getIdentityKey()
    const amount = parseInt(getVal('b20-transfer-amount'))

    if (!tokenId) throw new Error('No tokenId. Deploy BSV-20 first.')

    const result = await wallet.transferBsv20({
      op: 'transfer',
      ticker,
      tokenId,
      recipients: [{ to, amount }]
    })

    log('tx', `Transferred ${amount} ${ticker}`)
    return { txid: result.txid, standard: result.standard }
  })
}

export async function testBsv20Burn(wallet: Wallet) {
  return runTest('bsv20-burn', 'result-bsv20-burn', 'BSV-20: burnToken()', async () => {
    const outpoint = getVal('b20-burn-outpoint')
    if (!outpoint) throw new Error('No outpoint. Deploy/mint and list BSV-20 tokens first.')

    const result = await wallet.burnToken({
      basket: 'bsv20-tokens',
      outpoint,
      standard: 'bsv-20'
    })

    log('tx', 'Burned BSV-20 token')
    return result
  })
}

// ============================================================================
// Marketplace Tests
// ============================================================================

export async function testMarketListForSale(wallet: Wallet) {
  return runTest('market-list-sale', 'result-market-list-sale', 'Marketplace: listOrdinalForSale()', async () => {
    const basket = getVal('mkt-list-basket')
    const outpoint = getVal('mkt-list-outpoint')
    const price = parseInt(getVal('mkt-list-price'))

    if (!outpoint) throw new Error('No outpoint. Inscribe an ordinal first.')

    const result = await wallet.listOrdinalForSale({
      basket,
      outpoint,
      price
    })

    state.lastListingTxid = result.txid
    const listingOutpoint = `${result.txid}.0`
    state.lastListingOutpoint = listingOutpoint
    setVal('mkt-purchase-outpoint', listingOutpoint)
    setVal('mkt-cancel-outpoint', listingOutpoint)

    log('tx', `Listed for sale at ${price} sats`, `listing: ${listingOutpoint}`)
    return { txid: result.txid, listingOutpoint }
  })
}

export async function testMarketPurchase(wallet: Wallet) {
  return runTest('market-purchase', 'result-market-purchase', 'Marketplace: purchaseOrdinal()', async () => {
    const listingOutpoint = getVal('mkt-purchase-outpoint')
    if (!listingOutpoint) throw new Error('No listing outpoint. List an ordinal for sale first.')

    const result = await wallet.purchaseOrdinal({ listingOutpoint })

    log('tx', 'Purchased ordinal from marketplace')
    return result
  })
}

export async function testMarketCancel(wallet: Wallet) {
  return runTest('market-cancel', 'result-market-cancel', 'Marketplace: cancelOrdinalListing()', async () => {
    const listingOutpoint = getVal('mkt-cancel-outpoint')
    if (!listingOutpoint) throw new Error('No listing outpoint. List an ordinal for sale first.')

    const result = await wallet.cancelOrdinalListing({ listingOutpoint })

    log('tx', 'Cancelled listing, ordinal reclaimed')
    return result
  })
}

// ============================================================================
// Unified API Tests
// ============================================================================

export async function testUnifiedMint(wallet: Wallet) {
  return runTest('unified-mint', 'result-unified-mint', 'Unified: mintToken()', async () => {
    const standard = getVal('uni-mint-standard') as any
    const opts = JSON.parse(getVal('uni-mint-options'))
    opts.standard = standard === 'pushdrop' ? undefined : standard

    const result = await wallet.mintToken(opts)

    log('tx', `Minted via unified API: standard=${result.standard}`, `txid: ${result.txid}`)
    return { txid: result.txid, standard: result.standard, basket: result.basket, tokenId: result.tokenId }
  })
}

export async function testUnifiedList(wallet: Wallet) {
  return runTest('unified-list', 'result-unified-list', 'Unified: listTokens()', async () => {
    const standard = getVal('uni-list-standard') || undefined
    const basket = getVal('uni-list-basket') || undefined

    const opts: any = {}
    if (standard) opts.standard = standard
    if (basket) opts.basket = basket

    const tokens = await wallet.listTokens(opts)

    log('info', `Unified list: ${tokens.length} tokens found`)

    const byStandard: Record<string, number> = {}
    for (const t of tokens) {
      byStandard[t.standard] = (byStandard[t.standard] || 0) + 1
    }

    return {
      total: tokens.length,
      byStandard,
      tokens: tokens.slice(0, 20).map(t => ({
        outpoint: t.outpoint,
        standard: t.standard,
        satoshis: t.satoshis
      }))
    }
  })
}

export async function testUnifiedTransfer(wallet: Wallet) {
  return runTest('unified-transfer', 'result-unified-transfer', 'Unified: transferToken()', async () => {
    const basket = getVal('uni-transfer-basket')
    const outpoint = getVal('uni-transfer-outpoint')
    const to = getVal('uni-transfer-to') || wallet.getIdentityKey()
    const standard = getVal('uni-transfer-standard') || undefined

    if (!outpoint) throw new Error('No outpoint specified.')

    const result = await wallet.transferToken({
      basket,
      outpoint,
      to,
      standard: standard as any
    })

    log('tx', 'Transferred via unified API')
    return result
  })
}

export async function testUnifiedBurn(wallet: Wallet) {
  return runTest('unified-burn', 'result-unified-burn', 'Unified: burnToken()', async () => {
    const basket = getVal('uni-burn-basket')
    const outpoint = getVal('uni-burn-outpoint')
    const standard = getVal('uni-burn-standard') || undefined

    if (!outpoint) throw new Error('No outpoint specified.')

    const result = await wallet.burnToken({
      basket,
      outpoint,
      standard: standard as any
    })

    log('tx', 'Burned via unified API')
    return result
  })
}

// ============================================================================
// Run All Tests (sequential, creates then lists then transfers then burns)
// ============================================================================

export async function runAllTests(wallet: Wallet, onProgress: (pct: number) => void) {
  const steps = [
    { name: 'Wallet Info', fn: () => testWalletInfo(wallet) },
    // PushDrop lifecycle
    { name: 'PushDrop Create', fn: () => testPushDropCreate(wallet) },
    { name: 'PushDrop List', fn: () => testPushDropList(wallet) },
    // Ordinal lifecycle
    { name: 'Ordinal Inscribe', fn: () => testOrdinalInscribe(wallet) },
    { name: 'Ordinal List', fn: () => testOrdinalList(wallet) },
    // BSV-21 lifecycle
    { name: 'BSV-21 Deploy', fn: () => testBsv21Deploy(wallet) },
    { name: 'BSV-21 List', fn: () => testBsv21List(wallet) },
    // BSV-20 lifecycle
    { name: 'BSV-20 Deploy', fn: () => testBsv20Deploy(wallet) },
    { name: 'BSV-20 Mint', fn: () => testBsv20Mint(wallet) },
    { name: 'BSV-20 List', fn: () => testBsv20List(wallet) },
    // Unified API
    { name: 'Unified List All', fn: () => testUnifiedList(wallet) },
    { name: 'Unified Mint (PushDrop)', fn: () => {
      setVal('uni-mint-standard', 'pushdrop')
      setVal('uni-mint-options', JSON.stringify({ data: { test: 'unified-run-all' }, basket: 'test-tokens' }))
      return testUnifiedMint(wallet)
    }},
  ]

  log('info', `=== Running All Tests (${steps.length} steps) ===`)

  let completed = 0
  for (const step of steps) {
    try {
      await step.fn()
    } catch {
      // Logged in runTest, continue to next
    }
    completed++
    onProgress(Math.round((completed / steps.length) * 100))
  }

  log('info', `=== All Tests Complete ===`)
}
