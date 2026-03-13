import {
  Utils,
  P2PKH,
  PublicKey,
  Transaction,
  Beef,
  LockingScript,
  WalletProtocol,
  WalletCounterparty,
  Random
} from '@bsv/sdk'
import { WalletCore } from '../../core/WalletCore'
import { TransactionResult } from '../../core/types'
import { TokenAdapter } from './adapter'
import { Bsv21TokenInfo, MintTokenResult, DeployBsv21Options, TransferBsv21Options } from './types'
import OrdP2PKH from './templates/ord-p2pkh'
import { hasBsv20Envelope, extractInscriptionData } from './templates/script-validation'

const BSV21_BASKET = 'bsv21-tokens'
const BSV21_PROTOCOL_ID: WalletProtocol = [2, 'bsv21']

/**
 * BSV-21 fungible token adapter.
 * BSV-21 tokens use the ordinal inscription envelope with content type 'application/bsv-20'
 * and a JSON payload containing p:'bsv-20', op:'deploy+mint'|'transfer', and 'id' field.
 * Unlike BSV-20, BSV-21 uses atomic deploy+mint and tokenId (outpoint) rather than tickers.
 */
export class Bsv21Adapter implements TokenAdapter {
  readonly standard = 'bsv-21' as const

  async create (core: WalletCore, options: DeployBsv21Options | TransferBsv21Options): Promise<MintTokenResult> {
    const basket = options.basket ?? BSV21_BASKET

    if (options.op === 'deploy+mint') {
      return this.deployMint(core, options as DeployBsv21Options, basket)
    }
    return this.transfer(core, options as TransferBsv21Options, basket)
  }

  private async deployMint (core: WalletCore, options: DeployBsv21Options, basket: string): Promise<MintTokenResult> {
    const client = core.getClient()

    // Derive a key for locking
    const keyID = Utils.toBase64(Random(8))
    const counterparty: WalletCounterparty = 'self'

    const { publicKey: derivedPubKey } = await client.getPublicKey({
      protocolID: BSV21_PROTOCOL_ID,
      keyID,
      counterparty,
      forSelf: true
    })
    const address = PublicKey.fromString(derivedPubKey).toAddress()

    const inscriptionData: any = {
      p: 'bsv-20',
      op: 'deploy+mint',
      amt: String(options.amount)
    }
    if (options.symbol != null) inscriptionData.sym = options.symbol
    if (options.decimals != null) inscriptionData.dec = String(options.decimals)
    if (options.icon != null) inscriptionData.icon = options.icon

    const jsonString = JSON.stringify(inscriptionData)
    const dataB64 = Utils.toBase64(Utils.toArray(jsonString, 'utf8'))

    const ordP2PKH = new OrdP2PKH()
    const lockingScript = await ordP2PKH.lock({
      address,
      inscription: { dataB64, contentType: 'application/bsv-20' }
    })

    const result = await client.createAction({
      description: options.description ?? `Deploy BSV-21 token ${options.symbol ?? ''}`,
      outputs: [{
        lockingScript: lockingScript.toHex(),
        satoshis: 1,
        basket,
        customInstructions: JSON.stringify({
          standard: 'bsv-21',
          op: 'deploy+mint',
          symbol: options.symbol,
          amount: options.amount,
          decimals: options.decimals,
          protocolID: BSV21_PROTOCOL_ID,
          keyID,
          counterparty
        }),
        tags: ['bsv-21', 'deploy'],
        outputDescription: 'BSV-21 deploy+mint'
      }],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    })

    const txid = result.txid ?? ''
    const tokenId = `${txid}.0`

    return {
      txid,
      tx: result.tx,
      standard: 'bsv-21',
      basket,
      tokenId,
      outputs: [{ index: 0, satoshis: 1, lockingScript: lockingScript.toHex() }]
    }
  }

  private async transfer (core: WalletCore, options: TransferBsv21Options, basket: string): Promise<MintTokenResult> {
    const client = core.getClient()

    if (!options.recipients?.length) {
      throw new Error('At least one recipient is required for BSV-21 transfer')
    }
    if (!options.tokenId) {
      throw new Error('tokenId is required for BSV-21 transfer')
    }

    const actionOutputs: any[] = []

    for (let i = 0; i < options.recipients.length; i++) {
      const recipient = options.recipients[i]

      // Derive a unique key for each output
      const keyID = Utils.toBase64(Random(8))
      const isSelf = recipient.to === core.getIdentityKey()
      const counterparty: WalletCounterparty = isSelf ? 'self' : recipient.to as WalletCounterparty

      const { publicKey: derivedPubKey } = await client.getPublicKey({
        protocolID: BSV21_PROTOCOL_ID,
        keyID,
        counterparty,
        forSelf: true
      })
      const address = PublicKey.fromString(derivedPubKey).toAddress()

      const inscriptionData = {
        p: 'bsv-20',
        op: 'transfer',
        id: options.tokenId,
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
          standard: 'bsv-21',
          op: 'transfer',
          tokenId: options.tokenId,
          amount: recipient.amount,
          to: recipient.to,
          protocolID: BSV21_PROTOCOL_ID,
          keyID,
          counterparty
        }),
        tags: ['bsv-21', 'transfer'],
        outputDescription: `BSV-21 transfer to ${recipient.to.substring(0, 10)}...`
      })
    }

    const result = await client.createAction({
      description: options.description ?? 'BSV-21 token transfer',
      outputs: actionOutputs,
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    })

    return {
      txid: result.txid ?? '',
      tx: result.tx,
      standard: 'bsv-21',
      basket,
      tokenId: options.tokenId
    }
  }

  async list (core: WalletCore, basket: string): Promise<Bsv21TokenInfo[]> {
    const client = core.getClient()
    const result = await client.listOutputs({
      basket,
      include: 'locking scripts',
      includeCustomInstructions: true
    } as any)

    const outputs = result?.outputs ?? (Array.isArray(result) ? result : [])
    const details: Bsv21TokenInfo[] = []

    for (const output of outputs) {
      try {
        const hex = output.lockingScript as string
        if (!hasBsv20Envelope(hex)) continue

        const inscription = extractInscriptionData(hex)
        if (inscription == null) continue

        const jsonStr = new TextDecoder().decode(new Uint8Array(Utils.toArray(inscription.dataB64, 'base64')))
        const parsed = JSON.parse(jsonStr)

        // BSV-21 uses 'id' field or 'deploy+mint' op (no 'tick' field)
        if (parsed.tick != null) continue // This is BSV-20, not BSV-21

        const tokenId = parsed.id ?? output.outpoint
        details.push({
          outpoint: output.outpoint,
          satoshis: output.satoshis ?? 1,
          standard: 'bsv-21',
          lockingScript: hex,
          op: parsed.op,
          tokenId,
          amount: Number(parsed.amt) || 0,
          symbol: parsed.sym,
          decimals: parsed.dec != null ? Number(parsed.dec) : undefined
        })
      } catch {
        // Skip non-BSV-21 outputs
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
    if (targetOutput == null) throw new Error(`BSV-21 token not found: ${outpoint}`)

    // Parse stored derivation params
    let ci: any = {}
    if ((targetOutput as any).customInstructions != null) {
      try { ci = JSON.parse((targetOutput as any).customInstructions as string) } catch {}
    }
    const unlockProtocolID = ci.protocolID ?? BSV21_PROTOCOL_ID
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
      protocolID: BSV21_PROTOCOL_ID,
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
      description: `Transfer BSV-21 token from ${basket}`,
      inputBEEF,
      inputs: [{
        outpoint,
        inputDescription: 'BSV-21 token input',
        unlockingScriptLength: 108
      }],
      outputs: [{
        satoshis: 1,
        lockingScript: newLockingScript.toHex(),
        outputDescription: 'BSV-21 token for recipient',
        basket,
        customInstructions: JSON.stringify({
          standard: 'bsv-21',
          to,
          protocolID: BSV21_PROTOCOL_ID,
          keyID: newKeyID,
          counterparty: newCounterparty
        }),
        tags: ['bsv-21', 'sent']
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
    if (targetOutput == null) throw new Error(`BSV-21 token not found: ${outpoint}`)

    // Parse stored derivation params
    let ci: any = {}
    if ((targetOutput as any).customInstructions != null) {
      try { ci = JSON.parse((targetOutput as any).customInstructions as string) } catch {}
    }
    const unlockProtocolID = ci.protocolID ?? BSV21_PROTOCOL_ID
    const unlockKeyID = ci.keyID ?? '0'
    const unlockCounterparty = ci.counterparty ?? 'self'

    const beef = new Beef()
    beef.mergeBeef((result as any).BEEF as number[])

    const inputBEEF = beef.toBinary()
    const response = await client.createAction({
      description: `Burn BSV-21 token from ${basket}`,
      inputBEEF,
      inputs: [{
        outpoint,
        inputDescription: 'BSV-21 token to burn',
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
      return parsed.p === 'bsv-20' && parsed.tick == null
    } catch {
      return false
    }
  }
}
