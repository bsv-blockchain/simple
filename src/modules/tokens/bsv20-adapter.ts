import {
  Utils,
  PublicKey,
  Transaction,
  Beef,
  WalletProtocol,
  WalletCounterparty,
  Random
} from '@bsv/sdk'
import { WalletCore } from '../../core/WalletCore'
import { TransactionResult } from '../../core/types'
import { TokenAdapter } from './adapter'
import {
  Bsv20TokenInfo,
  MintTokenResult,
  DeployBsv20Options,
  MintBsv20TickerOptions,
  TransferBsv20Options
} from './types'
import OrdP2PKH from './templates/ord-p2pkh'
import { hasBsv20Envelope, extractInscriptionData } from './templates/script-validation'

const BSV20_BASKET = 'bsv20-tokens'
const BSV20_PROTOCOL_ID: WalletProtocol = [2, 'bsv20']

/**
 * BSV-20 v1 ticker-based fungible token adapter.
 * BSV-20 tokens use the ordinal inscription envelope with content type 'application/bsv-20'
 * and a JSON payload containing p:'bsv-20', op:'deploy'|'mint'|'transfer', and 'tick' field.
 */
export class Bsv20Adapter implements TokenAdapter {
  readonly standard = 'bsv-20' as const

  async create (core: WalletCore, options: DeployBsv20Options | MintBsv20TickerOptions | TransferBsv20Options): Promise<MintTokenResult> {
    const basket = options.basket ?? BSV20_BASKET

    if (options.op === 'deploy') {
      return this.deploy(core, options as DeployBsv20Options, basket)
    }
    if (options.op === 'mint') {
      return this.mint(core, options as MintBsv20TickerOptions, basket)
    }
    return this.transfer(core, options as TransferBsv20Options, basket)
  }

  private async deploy (core: WalletCore, options: DeployBsv20Options, basket: string): Promise<MintTokenResult> {
    const client = core.getClient()

    if (!options.ticker || typeof options.ticker !== 'string') {
      throw new Error('ticker is required for BSV-20 deploy')
    }
    if (!options.maxSupply || options.maxSupply <= 0) {
      throw new Error('maxSupply must be greater than 0')
    }
    if (options.mintLimit != null && options.mintLimit <= 0) {
      throw new Error('mintLimit must be greater than 0')
    }
    if (options.mintLimit != null && options.mintLimit > options.maxSupply) {
      throw new Error('mintLimit cannot exceed maxSupply')
    }

    const keyID = Utils.toBase64(Random(8))
    const counterparty: WalletCounterparty = 'self'

    const { publicKey: derivedPubKey } = await client.getPublicKey({
      protocolID: BSV20_PROTOCOL_ID,
      keyID,
      counterparty,
      forSelf: true
    })
    const address = PublicKey.fromString(derivedPubKey).toAddress()

    const inscriptionData: any = {
      p: 'bsv-20',
      op: 'deploy',
      tick: options.ticker,
      max: String(options.maxSupply)
    }
    if (options.mintLimit != null) inscriptionData.lim = String(options.mintLimit)
    if (options.decimals != null) inscriptionData.dec = String(options.decimals)

    const jsonString = JSON.stringify(inscriptionData)
    const dataB64 = Utils.toBase64(Utils.toArray(jsonString, 'utf8'))

    const ordP2PKH = new OrdP2PKH()
    const lockingScript = await ordP2PKH.lock({
      address,
      inscription: { dataB64, contentType: 'application/bsv-20' }
    })

    const result = await client.createAction({
      description: options.description ?? `Deploy BSV-20 token ${options.ticker}`,
      outputs: [{
        lockingScript: lockingScript.toHex(),
        satoshis: 1,
        basket,
        customInstructions: JSON.stringify({
          standard: 'bsv-20',
          op: 'deploy',
          ticker: options.ticker,
          protocolID: BSV20_PROTOCOL_ID,
          keyID,
          counterparty
        }),
        tags: ['bsv-20', 'deploy'],
        outputDescription: `BSV-20 deploy ${options.ticker}`
      }],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    })

    return {
      txid: result.txid ?? '',
      tx: result.tx,
      standard: 'bsv-20',
      basket,
      outputs: [{ index: 0, satoshis: 1, lockingScript: lockingScript.toHex() }]
    }
  }

  private async mint (core: WalletCore, options: MintBsv20TickerOptions, basket: string): Promise<MintTokenResult> {
    const client = core.getClient()

    if (!options.amount || options.amount <= 0) {
      throw new Error('amount must be greater than 0')
    }

    // Client-side validation: check mint limit and max supply from local deploy data.
    // This catches obviously invalid mints before creating a transaction.
    // Note: full validation requires an indexer (we can only check our own deploys).
    await this.validateMintLocally(client, basket, options.ticker, options.amount)

    const keyID = Utils.toBase64(Random(8))
    const counterparty: WalletCounterparty = 'self'

    const { publicKey: derivedPubKey } = await client.getPublicKey({
      protocolID: BSV20_PROTOCOL_ID,
      keyID,
      counterparty,
      forSelf: true
    })
    const address = PublicKey.fromString(derivedPubKey).toAddress()

    const inscriptionData = {
      p: 'bsv-20',
      op: 'mint',
      tick: options.ticker,
      amt: String(options.amount)
    }

    const jsonString = JSON.stringify(inscriptionData)
    const dataB64 = Utils.toBase64(Utils.toArray(jsonString, 'utf8'))

    const ordP2PKH = new OrdP2PKH()
    const lockingScript = await ordP2PKH.lock({
      address,
      inscription: { dataB64, contentType: 'application/bsv-20' }
    })

    const result = await client.createAction({
      description: options.description ?? `Mint BSV-20 token ${options.ticker}`,
      outputs: [{
        lockingScript: lockingScript.toHex(),
        satoshis: 1,
        basket,
        customInstructions: JSON.stringify({
          standard: 'bsv-20',
          op: 'mint',
          ticker: options.ticker,
          amount: options.amount,
          protocolID: BSV20_PROTOCOL_ID,
          keyID,
          counterparty
        }),
        tags: ['bsv-20', 'mint'],
        outputDescription: `BSV-20 mint ${options.ticker}`
      }],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    })

    return {
      txid: result.txid ?? '',
      tx: result.tx,
      standard: 'bsv-20',
      basket,
      outputs: [{ index: 0, satoshis: 1, lockingScript: lockingScript.toHex() }]
    }
  }

  private async transfer (core: WalletCore, options: TransferBsv20Options, basket: string): Promise<MintTokenResult> {
    const client = core.getClient()

    if (!options.recipients?.length) {
      throw new Error('At least one recipient is required for BSV-20 transfer')
    }

    const actionOutputs: any[] = []

    for (const recipient of options.recipients) {
      const keyID = Utils.toBase64(Random(8))
      const isSelf = recipient.to === core.getIdentityKey()
      const counterparty: WalletCounterparty = isSelf ? 'self' : recipient.to as WalletCounterparty

      const { publicKey: derivedPubKey } = await client.getPublicKey({
        protocolID: BSV20_PROTOCOL_ID,
        keyID,
        counterparty,
        forSelf: true
      })
      const address = PublicKey.fromString(derivedPubKey).toAddress()

      const inscriptionData = {
        p: 'bsv-20',
        op: 'transfer',
        tick: options.ticker,
        amt: String(recipient.amount)
      }

      const jsonString = JSON.stringify(inscriptionData)
      const dataB64 = Utils.toBase64(Utils.toArray(jsonString, 'utf8'))

      const ordP2PKH = new OrdP2PKH()
      const lockingScript = await ordP2PKH.lock({
        address,
        inscription: { dataB64, contentType: 'application/bsv-20' }
      })

      actionOutputs.push({
        lockingScript: lockingScript.toHex(),
        satoshis: 1,
        basket,
        customInstructions: JSON.stringify({
          standard: 'bsv-20',
          op: 'transfer',
          ticker: options.ticker,
          amount: recipient.amount,
          to: recipient.to,
          protocolID: BSV20_PROTOCOL_ID,
          keyID,
          counterparty
        }),
        tags: ['bsv-20', 'transfer'],
        outputDescription: `BSV-20 transfer ${options.ticker}`
      })
    }

    const result = await client.createAction({
      description: options.description ?? `BSV-20 transfer ${options.ticker}`,
      outputs: actionOutputs,
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    })

    return {
      txid: result.txid ?? '',
      tx: result.tx,
      standard: 'bsv-20',
      basket,
      tokenId: options.tokenId
    }
  }

  /**
   * Validates a mint request against local deploy and mint data in the basket.
   * This is a best-effort client-side check — full validation requires an indexer.
   *
   * Checks:
   * 1. If a deploy inscription for this ticker exists locally, enforce `lim` (per-mint cap)
   * 2. If a deploy inscription for this ticker exists locally, enforce `max` (total supply)
   */
  private async validateMintLocally (
    client: any,
    basket: string,
    ticker: string,
    amount: number
  ): Promise<void> {
    try {
      const result = await client.listOutputs({
        basket,
        include: 'locking scripts',
        includeCustomInstructions: true
      } as any)

      const outputs = result?.outputs ?? (Array.isArray(result) ? result : [])

      let deployData: { max?: number; lim?: number } | null = null
      let totalMinted = 0

      for (const output of outputs) {
        try {
          const hex = output.lockingScript as string
          if (!hasBsv20Envelope(hex)) continue

          const inscription = extractInscriptionData(hex)
          if (inscription == null) continue

          const jsonStr = new TextDecoder().decode(
            new Uint8Array(Utils.toArray(inscription.dataB64, 'base64'))
          )
          const parsed = JSON.parse(jsonStr)
          if (parsed.p !== 'bsv-20' || parsed.tick !== ticker) continue

          if (parsed.op === 'deploy') {
            deployData = {
              max: parsed.max != null ? Number(parsed.max) : undefined,
              lim: parsed.lim != null ? Number(parsed.lim) : undefined
            }
          } else if (parsed.op === 'mint') {
            totalMinted += Number(parsed.amt) || 0
          }
        } catch {
          // Skip malformed outputs
        }
      }

      if (deployData != null) {
        // Check per-mint limit
        if (deployData.lim != null && amount > deployData.lim) {
          throw new Error(
            `Mint amount ${amount} exceeds the per-mint limit of ${deployData.lim} for ticker "${ticker}". ` +
            `BSV-20 indexers will reject this mint as invalid.`
          )
        }

        // Check total supply cap
        if (deployData.max != null && (totalMinted + amount) > deployData.max) {
          const remaining = deployData.max - totalMinted
          throw new Error(
            `Mint amount ${amount} would exceed max supply of ${deployData.max} for ticker "${ticker}" ` +
            `(already minted: ${totalMinted}, remaining: ${remaining}). ` +
            `BSV-20 indexers will reject this mint as invalid.`
          )
        }
      }
    } catch (err) {
      // Re-throw validation errors, swallow listOutputs failures
      if ((err as Error).message?.includes('exceeds')) throw err
      if ((err as Error).message?.includes('would exceed')) throw err
    }
  }

  async list (core: WalletCore, basket: string): Promise<Bsv20TokenInfo[]> {
    const client = core.getClient()
    const result = await client.listOutputs({
      basket,
      include: 'locking scripts',
      includeCustomInstructions: true
    } as any)

    const outputs = result?.outputs ?? (Array.isArray(result) ? result : [])
    const details: Bsv20TokenInfo[] = []

    for (const output of outputs) {
      try {
        const hex = output.lockingScript as string
        if (!hasBsv20Envelope(hex)) continue

        const inscription = extractInscriptionData(hex)
        if (inscription == null) continue

        const jsonStr = new TextDecoder().decode(new Uint8Array(Utils.toArray(inscription.dataB64, 'base64')))
        const parsed = JSON.parse(jsonStr)

        // BSV-20 v1 uses 'tick' field
        if (parsed.tick == null) continue // This is BSV-21, not BSV-20

        details.push({
          outpoint: output.outpoint,
          satoshis: output.satoshis ?? 1,
          standard: 'bsv-20',
          lockingScript: hex,
          op: parsed.op,
          ticker: parsed.tick,
          amount: Number(parsed.amt) || 0,
          decimals: parsed.dec != null ? Number(parsed.dec) : undefined
        })
      } catch {
        // Skip non-BSV-20 outputs
      }
    }

    return details
  }

  async send (core: WalletCore, options: {
    basket: string
    outpoint: string
    to: string
  }): Promise<TransactionResult> {
    const client = core.getClient()
    const { basket, outpoint, to } = options

    const result = await client.listOutputs({
      basket,
      include: 'entire transactions',
      includeCustomInstructions: true
    } as any)

    const outputs = result?.outputs ?? []
    const targetOutput = outputs.find((o: any) => o.outpoint === outpoint)
    if (targetOutput == null) throw new Error(`BSV-20 token not found: ${outpoint}`)

    // Parse stored derivation params
    let ci: any = {}
    if ((targetOutput as any).customInstructions != null) {
      try { ci = JSON.parse((targetOutput as any).customInstructions as string) } catch {}
    }
    const unlockProtocolID = ci.protocolID ?? BSV20_PROTOCOL_ID
    const unlockKeyID = ci.keyID ?? '0'
    const unlockCounterparty = ci.counterparty ?? 'self'

    const beef = new Beef()
    beef.mergeBeef((result as any).BEEF as number[])

    const [txid, voutStr] = outpoint.split('.')
    const vout = Number(voutStr)
    const sourceTx = beef.findAtomicTransaction(txid) as Transaction
    const sourceScript = sourceTx.outputs[vout].lockingScript

    const inscription = extractInscriptionData(sourceScript)
    if (inscription == null) throw new Error('Failed to extract inscription data')

    // Derive a new key for recipient
    const newKeyID = Utils.toBase64(Random(8))
    const isSelfSend = to === core.getIdentityKey()
    const newCounterparty: WalletCounterparty = isSelfSend ? 'self' : to as WalletCounterparty

    const { publicKey: newPubKey } = await client.getPublicKey({
      protocolID: BSV20_PROTOCOL_ID,
      keyID: newKeyID,
      counterparty: newCounterparty,
      forSelf: true
    })
    const recipientAddress = PublicKey.fromString(newPubKey).toAddress()

    const ordP2PKH = new OrdP2PKH()
    const newLockingScript = await ordP2PKH.lock({
      address: recipientAddress,
      inscription
    })

    const inputBEEF = beef.toBinary()
    const response = await client.createAction({
      description: `Transfer BSV-20 token from ${basket}`,
      inputBEEF,
      inputs: [{
        outpoint,
        inputDescription: 'BSV-20 token input',
        unlockingScriptLength: 108
      }],
      outputs: [{
        satoshis: 1,
        lockingScript: newLockingScript.toHex(),
        outputDescription: 'BSV-20 token for recipient',
        basket,
        customInstructions: JSON.stringify({
          standard: 'bsv-20',
          to,
          protocolID: BSV20_PROTOCOL_ID,
          keyID: newKeyID,
          counterparty: newCounterparty
        }),
        tags: ['bsv-20', 'sent']
      }],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    } as any)

    if ((response as any)?.signableTransaction == null) {
      throw new Error('Expected signableTransaction')
    }

    const signable = (response as any).signableTransaction
    const txToSign = Transaction.fromBEEF(signable.tx)
    txToSign.inputs[0].unlockingScriptTemplate = new OrdP2PKH(client).unlock({
      protocolID: unlockProtocolID as WalletProtocol,
      keyID: unlockKeyID,
      counterparty: unlockCounterparty as WalletCounterparty
    })
    await txToSign.sign()

    const unlockingScript = txToSign.inputs[0].unlockingScript?.toHex()
    if (!unlockingScript) throw new Error('Failed to generate unlocking script')

    const finalResult = await client.signAction({
      reference: signable.reference,
      spends: { 0: { unlockingScript } }
    })

    return {
      txid: (finalResult as any).txid ?? '',
      tx: (finalResult as any).tx
    }
  }

  async redeem (core: WalletCore, options: {
    basket: string
    outpoint: string
  }): Promise<TransactionResult> {
    const client = core.getClient()
    const { basket, outpoint } = options

    const result = await client.listOutputs({
      basket,
      include: 'entire transactions',
      includeCustomInstructions: true
    } as any)

    const outputs = result?.outputs ?? []
    const targetOutput = outputs.find((o: any) => o.outpoint === outpoint)
    if (targetOutput == null) throw new Error(`BSV-20 token not found: ${outpoint}`)

    // Parse stored derivation params
    let ci: any = {}
    if ((targetOutput as any).customInstructions != null) {
      try { ci = JSON.parse((targetOutput as any).customInstructions as string) } catch {}
    }
    const unlockProtocolID = ci.protocolID ?? BSV20_PROTOCOL_ID
    const unlockKeyID = ci.keyID ?? '0'
    const unlockCounterparty = ci.counterparty ?? 'self'

    const beef = new Beef()
    beef.mergeBeef((result as any).BEEF as number[])

    const inputBEEF = beef.toBinary()
    const response = await client.createAction({
      description: `Burn BSV-20 token from ${basket}`,
      inputBEEF,
      inputs: [{
        outpoint,
        inputDescription: 'BSV-20 token to burn',
        unlockingScriptLength: 108
      }],
      outputs: [],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    } as any)

    if ((response as any)?.signableTransaction == null) {
      throw new Error('Expected signableTransaction')
    }

    const signable = (response as any).signableTransaction
    const txToSign = Transaction.fromBEEF(signable.tx)
    txToSign.inputs[0].unlockingScriptTemplate = new OrdP2PKH(client).unlock({
      protocolID: unlockProtocolID as WalletProtocol,
      keyID: unlockKeyID,
      counterparty: unlockCounterparty as WalletCounterparty
    })
    await txToSign.sign()

    const unlockingScript = txToSign.inputs[0].unlockingScript?.toHex()
    if (!unlockingScript) throw new Error('Failed to generate unlocking script')

    const finalResult = await client.signAction({
      reference: signable.reference,
      spends: { 0: { unlockingScript } }
    })

    return {
      txid: (finalResult as any).txid ?? '',
      tx: (finalResult as any).tx
    }
  }

  detectFromScript (lockingScriptHex: string): boolean {
    if (!hasBsv20Envelope(lockingScriptHex)) return false
    try {
      const inscription = extractInscriptionData(lockingScriptHex)
      if (inscription == null) return false
      const jsonStr = new TextDecoder().decode(new Uint8Array(Utils.toArray(inscription.dataB64, 'base64')))
      const parsed = JSON.parse(jsonStr)
      return parsed.p === 'bsv-20' && parsed.tick != null
    } catch {
      return false
    }
  }
}
