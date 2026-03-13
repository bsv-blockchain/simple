import {
  Utils,
  PushDrop,
  SecurityLevel,
  Random,
  LockingScript,
  Transaction,
  Beef
} from '@bsv/sdk'
import { WalletCore } from '../../core/WalletCore'
import { TransactionResult } from '../../core/types'
import { TokenAdapter } from './adapter'
import { PushDropTokenInfo, MintTokenResult } from './types'

/**
 * PushDrop adapter — extracts existing PushDrop logic from tokens.ts
 * into the adapter pattern for use by the unified token API.
 */
export class PushDropAdapter implements TokenAdapter {
  readonly standard = 'pushdrop' as const

  async create (core: WalletCore, options: {
    to?: string
    data: any
    basket?: string
    protocolID?: [number, string]
    keyID?: string
    satoshis?: number
    description?: string
  }): Promise<MintTokenResult> {
    const client = core.getClient()
    const basket = options.basket ?? core.defaults.tokenBasket
    const protocolID = (options.protocolID ?? core.defaults.tokenProtocolID) as [SecurityLevel, string]
    const keyID = options.keyID ?? core.defaults.tokenKeyID
    const satoshis = options.satoshis ?? 1

    const dataString = typeof options.data === 'object'
      ? JSON.stringify(options.data)
      : String(options.data)

    const plaintext = Array.from(Utils.toArray(dataString, 'utf8'))
    const encryptResult = await client.encrypt({
      plaintext,
      protocolID,
      keyID,
      counterparty: 'self'
    } as any)

    const ciphertext = Array.from(encryptResult.ciphertext)
    const pushdrop = new PushDrop(client)
    const lockingScript = await pushdrop.lock(
      [ciphertext],
      protocolID,
      keyID,
      'self',
      true,
      false
    )

    const result = await client.createAction({
      description: options.description ?? `Create token in ${basket} basket`,
      outputs: [{
        lockingScript: lockingScript.toHex(),
        satoshis,
        basket,
        customInstructions: JSON.stringify({ protocolID, keyID, counterparty: 'self' }),
        tags: ['token'],
        outputDescription: `Token (${basket})`
      }],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    })

    return {
      txid: result.txid ?? '',
      tx: result.tx,
      standard: 'pushdrop',
      basket,
      outputs: [{ index: 0, satoshis, lockingScript: lockingScript.toHex() }]
    }
  }

  async list (core: WalletCore, basket: string): Promise<PushDropTokenInfo[]> {
    const client = core.getClient()
    const result = await client.listOutputs({
      basket,
      include: 'locking scripts',
      includeCustomInstructions: true
    } as any)

    const outputs = result?.outputs ?? (Array.isArray(result) ? result : [])
    const details: PushDropTokenInfo[] = []

    const defaultProtocolID = core.defaults.tokenProtocolID
    const defaultKeyID = core.defaults.tokenKeyID

    for (const output of outputs) {
      try {
        const lockScript = LockingScript.fromHex(output.lockingScript as string)
        const decoded = PushDrop.decode(lockScript)

        let ci: any = {}
        if ((output as any).customInstructions != null) {
          try { ci = JSON.parse((output as any).customInstructions as string) } catch {}
        }
        const protocolID = ci.protocolID ?? defaultProtocolID
        const keyID = ci.keyID ?? defaultKeyID
        const counterparty = ci.counterparty ?? 'self'

        let data: any = null
        if (decoded.fields[0] != null) {
          try {
            const { plaintext } = await client.decrypt({
              ciphertext: Array.from(decoded.fields[0]),
              protocolID,
              keyID,
              counterparty
            } as any)
            const text = new TextDecoder().decode(new Uint8Array(plaintext))
            try { data = JSON.parse(text) } catch { data = text }
          } catch {
            if (counterparty === 'self') {
              try {
                const { plaintext } = await client.decrypt({
                  ciphertext: Array.from(decoded.fields[0]),
                  protocolID,
                  keyID,
                  counterparty: 'anyone'
                } as any)
                const text = new TextDecoder().decode(new Uint8Array(plaintext))
                try { data = JSON.parse(text) } catch { data = text }
              } catch {
                data = null
              }
            }
          }
        }

        details.push({
          outpoint: output.outpoint,
          satoshis: output.satoshis ?? 0,
          standard: 'pushdrop',
          lockingScript: output.lockingScript as string,
          data,
          protocolID,
          keyID,
          counterparty
        })
      } catch {
        // Skip non-PushDrop outputs
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

    const defaultProtocolID: [number, string] = core.defaults.tokenProtocolID
    const defaultKeyID = core.defaults.tokenKeyID

    const result = await client.listOutputs({
      basket,
      include: 'entire transactions',
      includeCustomInstructions: true
    } as any)

    const outputs = result?.outputs ?? []
    const targetOutput = outputs.find((o: any) => o.outpoint === outpoint)
    if (targetOutput == null) throw new Error(`Token not found: ${outpoint}`)

    let ci: any = {}
    if ((targetOutput as any).customInstructions != null) {
      try { ci = JSON.parse((targetOutput as any).customInstructions as string) } catch {}
    }
    const protocolID = ci.protocolID ?? defaultProtocolID
    const keyID = ci.keyID ?? defaultKeyID
    const counterparty = ci.counterparty ?? 'self'

    const beef = new Beef()
    beef.mergeBeef((result as any).BEEF as number[])

    const [txid, voutStr] = outpoint.split('.')
    const vout = Number(voutStr)
    const sourceTx = beef.findAtomicTransaction(txid) as Transaction
    const sourceScript = sourceTx.outputs[vout].lockingScript
    const decoded = PushDrop.decode(sourceScript)

    const newKeyID = Utils.toBase64(Random(8))
    const pushdrop = new PushDrop(client)
    const isSelfSend = to === core.getIdentityKey()
    const newLockingScript = await pushdrop.lock(
      decoded.fields.map((f: number[]) => Array.from(f)),
      protocolID as [SecurityLevel, string],
      newKeyID,
      isSelfSend ? 'self' : to,
      isSelfSend,
      false
    )

    const newCounterparty = isSelfSend ? 'self' : to

    const inputBEEF = beef.toBinary()
    const response = await client.createAction({
      description: `Send token from ${basket}`,
      inputBEEF,
      inputs: [{
        outpoint,
        inputDescription: 'Token input',
        unlockingScriptLength: 73
      }],
      outputs: [{
        satoshis: 1,
        lockingScript: newLockingScript.toHex(),
        outputDescription: 'Token for recipient',
        basket,
        customInstructions: JSON.stringify({ protocolID, keyID: newKeyID, counterparty: newCounterparty }),
        tags: ['token', 'sent']
      }],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    } as any)

    if ((response as any)?.signableTransaction == null) {
      throw new Error('Expected signableTransaction')
    }

    const signable = (response as any).signableTransaction
    const txToSign = Transaction.fromBEEF(signable.tx)
    txToSign.inputs[0].unlockingScriptTemplate = new PushDrop(client).unlock(
      protocolID as [SecurityLevel, string],
      keyID,
      counterparty
    )
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

    const defaultProtocolID: [number, string] = core.defaults.tokenProtocolID
    const defaultKeyID = core.defaults.tokenKeyID

    const result = await client.listOutputs({
      basket,
      include: 'entire transactions',
      includeCustomInstructions: true
    } as any)

    const outputs = result?.outputs ?? []
    const targetOutput = outputs.find((o: any) => o.outpoint === outpoint)
    if (targetOutput == null) throw new Error(`Token not found: ${outpoint}`)

    let ci: any = {}
    if ((targetOutput as any).customInstructions != null) {
      try { ci = JSON.parse((targetOutput as any).customInstructions as string) } catch {}
    }
    const protocolID = ci.protocolID ?? defaultProtocolID
    const keyID = ci.keyID ?? defaultKeyID
    const counterparty = ci.counterparty ?? 'self'

    const beef = new Beef()
    beef.mergeBeef((result as any).BEEF as number[])

    const inputBEEF = beef.toBinary()
    const response = await client.createAction({
      description: `Redeem token from ${basket}`,
      inputBEEF,
      inputs: [{
        outpoint,
        inputDescription: 'Token to redeem',
        unlockingScriptLength: 73
      }],
      outputs: [],
      options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
    } as any)

    if ((response as any)?.signableTransaction == null) {
      throw new Error('Expected signableTransaction')
    }

    const signable = (response as any).signableTransaction
    const txToSign = Transaction.fromBEEF(signable.tx)
    txToSign.inputs[0].unlockingScriptTemplate = new PushDrop(client).unlock(
      protocolID as [SecurityLevel, string],
      keyID,
      counterparty
    )
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

  detectFromScript (_lockingScriptHex: string): boolean {
    // PushDrop cannot be reliably detected from raw hex without attempting decode.
    // This returns false; the unified list method uses basket-level fallback.
    return false
  }
}
