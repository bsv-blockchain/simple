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
import { OrdinalTokenInfo, MintTokenResult, InscribeOrdinalOptions } from './types'
import OrdP2PKH from './templates/ord-p2pkh'
import {
  hasOrdEnvelope,
  hasBsv20Envelope,
  extractInscriptionData,
  extractMapMetadata
} from './templates/script-validation'

const ORDINAL_BASKET = 'ordinals'
const ORD_PROTOCOL_ID: WalletProtocol = [2, 'ordp2pkh']

/**
 * 1Sat Ordinal NFT adapter.
 * Creates inscriptions using the ordinal envelope format (OP_FALSE OP_IF 'ord' ... OP_ENDIF)
 * with arbitrary content types, locked to P2PKH.
 *
 * Uses wallet key derivation so that the derived public key used for locking
 * matches the key used for signing during unlock.
 */
export class OrdinalAdapter implements TokenAdapter {
  readonly standard = 'ordinal' as const

  async create (core: WalletCore, options: InscribeOrdinalOptions): Promise<MintTokenResult> {
    const client = core.getClient()
    const basket = options.basket ?? ORDINAL_BASKET

    // Convert content to base64
    let dataB64: string
    if (typeof options.content === 'string') {
      dataB64 = Utils.toBase64(Utils.toArray(options.content, 'utf8'))
    } else {
      dataB64 = Utils.toBase64(Array.from(options.content))
    }

    // Derive a key for locking. Use a unique keyID per inscription so each
    // output is locked to a distinct derived key.
    const keyID = Utils.toBase64(Random(8))
    const counterparty: WalletCounterparty = 'self'

    // Get the derived public key that corresponds to our protocolID + keyID
    const { publicKey: derivedPubKey } = await client.getPublicKey({
      protocolID: ORD_PROTOCOL_ID,
      keyID,
      counterparty,
      forSelf: true
    })
    const address = PublicKey.fromString(derivedPubKey).toAddress()

    const ordP2PKH = new OrdP2PKH()
    const lockingScript = await ordP2PKH.lock({
      address,
      inscription: { dataB64, contentType: options.contentType },
      metadata: options.metadata
    })

    const result = await client.createAction({
      description: options.description ?? `Inscribe ordinal in ${basket}`,
      outputs: [{
        lockingScript: lockingScript.toHex(),
        satoshis: 1,
        basket,
        customInstructions: JSON.stringify({
          standard: 'ordinal',
          contentType: options.contentType,
          protocolID: ORD_PROTOCOL_ID,
          keyID,
          counterparty
        }),
        tags: ['ordinal', 'nft'],
        outputDescription: 'Ordinal inscription'
      }],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    })

    return {
      txid: result.txid ?? '',
      tx: result.tx,
      standard: 'ordinal',
      basket,
      outputs: [{ index: 0, satoshis: 1, lockingScript: lockingScript.toHex() }]
    }
  }

  async list (core: WalletCore, basket: string): Promise<OrdinalTokenInfo[]> {
    const client = core.getClient()
    const result = await client.listOutputs({
      basket,
      include: 'locking scripts',
      includeCustomInstructions: true
    } as any)

    const outputs = result?.outputs ?? (Array.isArray(result) ? result : [])
    const details: OrdinalTokenInfo[] = []

    for (const output of outputs) {
      try {
        const hex = output.lockingScript as string
        // Only include outputs with an ordinal envelope but NOT bsv-20 specific
        if (!hasOrdEnvelope(hex) || hasBsv20Envelope(hex)) continue

        const inscription = extractInscriptionData(hex)
        if (inscription == null) continue

        const metadata = extractMapMetadata(hex) ?? undefined

        details.push({
          outpoint: output.outpoint,
          satoshis: output.satoshis ?? 1,
          standard: 'ordinal',
          lockingScript: hex,
          contentType: inscription.contentType,
          dataB64: inscription.dataB64,
          metadata
        })
      } catch {
        // Skip non-ordinal outputs
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
    if (targetOutput == null) throw new Error(`Ordinal not found: ${outpoint}`)

    // Parse stored derivation params for unlocking
    let ci: any = {}
    if ((targetOutput as any).customInstructions != null) {
      try { ci = JSON.parse((targetOutput as any).customInstructions as string) } catch {}
    }
    const unlockProtocolID = ci.protocolID ?? ORD_PROTOCOL_ID
    const unlockKeyID = ci.keyID ?? '0'
    const unlockCounterparty = ci.counterparty ?? 'self'

    const beef = new Beef()
    beef.mergeBeef((result as any).BEEF as number[])

    const [txid, voutStr] = outpoint.split('.')
    const vout = Number(voutStr)
    const sourceTx = beef.findAtomicTransaction(txid) as Transaction
    const sourceScript = sourceTx.outputs[vout].lockingScript

    // Extract inscription data to re-inscribe to new owner
    const inscription = extractInscriptionData(sourceScript)
    const metadata = extractMapMetadata(sourceScript)

    // Derive a new key for the recipient output
    const newKeyID = Utils.toBase64(Random(8))
    const isSelfSend = to === core.getIdentityKey()
    const newCounterparty: WalletCounterparty = isSelfSend ? 'self' : to as WalletCounterparty

    const { publicKey: newPubKey } = await client.getPublicKey({
      protocolID: ORD_PROTOCOL_ID,
      keyID: newKeyID,
      counterparty: newCounterparty,
      forSelf: true
    })
    const recipientAddress = PublicKey.fromString(newPubKey).toAddress()

    const ordP2PKH = new OrdP2PKH()
    const newLockingScript = await ordP2PKH.lock({
      address: recipientAddress,
      inscription: inscription ?? undefined,
      metadata: metadata ?? undefined
    })

    const inputBEEF = beef.toBinary()
    const response = await client.createAction({
      description: `Transfer ordinal from ${basket}`,
      inputBEEF,
      inputs: [{
        outpoint,
        inputDescription: 'Ordinal input',
        unlockingScriptLength: 108
      }],
      outputs: [{
        satoshis: 1,
        lockingScript: newLockingScript.toHex(),
        outputDescription: 'Ordinal for recipient',
        basket,
        customInstructions: JSON.stringify({
          standard: 'ordinal',
          protocolID: ORD_PROTOCOL_ID,
          keyID: newKeyID,
          counterparty: newCounterparty,
          to
        }),
        tags: ['ordinal', 'sent']
      }],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    } as any)

    if ((response as any)?.signableTransaction == null) {
      throw new Error('Expected signableTransaction')
    }

    const signable = (response as any).signableTransaction
    const txToSign = Transaction.fromBEEF(signable.tx)

    // Unlock using the derivation params from when the ordinal was locked
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
    if (targetOutput == null) throw new Error(`Ordinal not found: ${outpoint}`)

    // Parse stored derivation params for unlocking
    let ci: any = {}
    if ((targetOutput as any).customInstructions != null) {
      try { ci = JSON.parse((targetOutput as any).customInstructions as string) } catch {}
    }
    const unlockProtocolID = ci.protocolID ?? ORD_PROTOCOL_ID
    const unlockKeyID = ci.keyID ?? '0'
    const unlockCounterparty = ci.counterparty ?? 'self'

    const beef = new Beef()
    beef.mergeBeef((result as any).BEEF as number[])

    const inputBEEF = beef.toBinary()
    const response = await client.createAction({
      description: `Burn ordinal from ${basket}`,
      inputBEEF,
      inputs: [{
        outpoint,
        inputDescription: 'Ordinal to burn',
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
    return hasOrdEnvelope(lockingScriptHex) && !hasBsv20Envelope(lockingScriptHex)
  }
}
