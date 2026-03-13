import {
  Utils,
  PushDrop,
  SecurityLevel,
  Random,
  LockingScript,
  Transaction,
  Beef
} from '@bsv/sdk'
import { PeerPayClient } from '@bsv/message-box-client'
import { WalletCore } from '../core/WalletCore'
import {
  TokenOptions,
  TokenResult,
  TokenDetail,
  SendTokenOptions,
  RedeemTokenOptions,
  TransactionResult
} from '../core/types'

// New token standard types & adapters
import {
  TokenStandard,
  MintTokenOptions,
  MintPushDropOptions,
  MintOrdinalOptions,
  MintBsv21Options,
  MintBsv20Options,
  MintTokenResult,
  UnifiedTokenInfo,
  ListTokensOptions,
  TransferTokenOptions,
  BurnTokenOptions,
  InscribeOrdinalOptions,
  DeployBsv21Options,
  TransferBsv21Options,
  DeployBsv20Options,
  MintBsv20TickerOptions,
  TransferBsv20Options
} from './tokens/types'
import { PushDropAdapter } from './tokens/pushdrop-adapter'
import { OrdinalAdapter } from './tokens/ordinal-adapter'
import { Bsv21Adapter } from './tokens/bsv21-adapter'
import { Bsv20Adapter } from './tokens/bsv20-adapter'
import { detectStandard } from './tokens/detection'

const TOKEN_MESSAGE_BOX = 'simple_token_inbox'

// Singleton adapter instances
const pushDropAdapter = new PushDropAdapter()
const ordinalAdapter = new OrdinalAdapter()
const bsv21Adapter = new Bsv21Adapter()
const bsv20Adapter = new Bsv20Adapter()

function getAdapter (standard: TokenStandard) {
  switch (standard) {
    case 'pushdrop': return pushDropAdapter
    case 'ordinal': return ordinalAdapter
    case 'bsv-21': return bsv21Adapter
    case 'bsv-20': return bsv20Adapter
    default: throw new Error(`Unknown token standard: ${standard as string}`)
  }
}

function getDefaultBasket (core: WalletCore, standard: TokenStandard): string {
  switch (standard) {
    case 'pushdrop': return core.defaults.tokenBasket
    case 'ordinal': return core.defaults.ordinalBasket
    case 'bsv-21': return core.defaults.bsv21Basket
    case 'bsv-20': return core.defaults.bsv20Basket
  }
}

export function createTokenMethods (core: WalletCore): {
  // === Backward-compatible PushDrop methods ===
  createToken: (options: TokenOptions) => Promise<TokenResult>
  listTokenDetails: (basket?: string) => Promise<TokenDetail[]>
  sendToken: (options: SendTokenOptions) => Promise<TransactionResult>
  redeemToken: (options: RedeemTokenOptions) => Promise<TransactionResult>
  sendTokenViaMessageBox: (options: SendTokenOptions) => Promise<TransactionResult>
  listIncomingTokens: () => Promise<any[]>
  acceptIncomingToken: (token: any, basket?: string) => Promise<any>
  // === New unified methods ===
  mintToken: (options: MintTokenOptions) => Promise<MintTokenResult>
  listTokens: (options?: ListTokensOptions) => Promise<UnifiedTokenInfo[]>
  transferToken: (options: TransferTokenOptions) => Promise<TransactionResult>
  burnToken: (options: BurnTokenOptions) => Promise<TransactionResult>
  // === Standard-specific convenience methods ===
  inscribeOrdinal: (options: InscribeOrdinalOptions) => Promise<MintTokenResult>
  deployBsv21: (options: DeployBsv21Options) => Promise<MintTokenResult>
  transferBsv21: (options: TransferBsv21Options) => Promise<MintTokenResult>
  deployBsv20: (options: DeployBsv20Options) => Promise<MintTokenResult>
  mintBsv20: (options: MintBsv20TickerOptions) => Promise<MintTokenResult>
  transferBsv20: (options: TransferBsv20Options) => Promise<MintTokenResult>
} {
  return {
    // ========================================================================
    // Backward-compatible PushDrop methods (unchanged signatures)
    // ========================================================================

    async createToken (options: TokenOptions): Promise<TokenResult> {
      try {
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
          description: `Create token in ${basket} basket`,
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
          basket,
          encrypted: true,
          outputs: [{ index: 0, satoshis, lockingScript: lockingScript.toHex() }]
        }
      } catch (error) {
        throw new Error(`Token creation failed: ${(error as Error).message}`)
      }
    },

    async listTokenDetails (basket?: string): Promise<TokenDetail[]> {
      const effectiveBasket = basket ?? core.defaults.tokenBasket
      const client = core.getClient()
      const result = await client.listOutputs({
        basket: effectiveBasket,
        include: 'locking scripts',
        includeCustomInstructions: true
      } as any)

      const outputs = result?.outputs ?? (Array.isArray(result) ? result : [])
      const details: TokenDetail[] = []

      const defaultProtocolID = core.defaults.tokenProtocolID
      const defaultKeyID = core.defaults.tokenKeyID
      const defaultCounterparty = 'self'

      for (const output of outputs) {
        try {
          const lockScript = LockingScript.fromHex(output.lockingScript as string)
          const decoded = PushDrop.decode(lockScript)

          let ci: any = {}
          if ((output as any).customInstructions != null) {
            try { ci = JSON.parse((output as any).customInstructions as string) } catch {}
          }
          const protocolID = ci.protocolID != null ? ci.protocolID : defaultProtocolID
          const keyID = ci.keyID != null ? (ci.keyID as string) : defaultKeyID
          const counterparty = ci.counterparty != null ? (ci.counterparty as string) : defaultCounterparty

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
              // Fallback: try 'anyone' for pre-fix tokens
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
              } else {
                data = null
              }
            }
          }

          details.push({
            outpoint: output.outpoint,
            satoshis: output.satoshis ?? 0,
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
    },

    async sendToken (options: SendTokenOptions): Promise<TransactionResult> {
      try {
        const client = core.getClient()
        const { basket, outpoint, to } = options

        const defaultProtocolID: [number, string] = core.defaults.tokenProtocolID
        const defaultKeyID = core.defaults.tokenKeyID
        const defaultCounterparty = 'self'

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
        const protocolID = ci.protocolID != null ? ci.protocolID : defaultProtocolID
        const keyID = ci.keyID != null ? (ci.keyID as string) : defaultKeyID
        const counterparty = ci.counterparty != null ? (ci.counterparty as string) : defaultCounterparty

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
        if (unlockingScript == null || unlockingScript === '') throw new Error('Failed to generate unlocking script')

        const finalResult = await client.signAction({
          reference: signable.reference,
          spends: { 0: { unlockingScript } }
        })

        return {
          txid: (finalResult as any).txid ?? '',
          tx: (finalResult as any).tx
        }
      } catch (error) {
        throw new Error(`Token send failed: ${(error as Error).message}`)
      }
    },

    async redeemToken (options: RedeemTokenOptions): Promise<TransactionResult> {
      try {
        const client = core.getClient()
        const { basket, outpoint } = options

        const defaultProtocolID: [number, string] = core.defaults.tokenProtocolID
        const defaultKeyID = core.defaults.tokenKeyID
        const defaultCounterparty = 'self'

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
        const protocolID = ci.protocolID != null ? ci.protocolID : defaultProtocolID
        const keyID = ci.keyID != null ? (ci.keyID as string) : defaultKeyID
        const counterparty = ci.counterparty != null ? (ci.counterparty as string) : defaultCounterparty

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
        if (unlockingScript == null || unlockingScript === '') throw new Error('Failed to generate unlocking script')

        const finalResult = await client.signAction({
          reference: signable.reference,
          spends: { 0: { unlockingScript } }
        })

        return {
          txid: (finalResult as any).txid ?? '',
          tx: (finalResult as any).tx
        }
      } catch (error) {
        throw new Error(`Token redeem failed: ${(error as Error).message}`)
      }
    },

    async sendTokenViaMessageBox (options: SendTokenOptions): Promise<TransactionResult> {
      try {
        const client = core.getClient()
        const { basket, outpoint, to } = options

        const defaultProtocolID: [number, string] = core.defaults.tokenProtocolID
        const defaultKeyID = core.defaults.tokenKeyID
        const defaultCounterparty = 'self'

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
        const protocolID = ci.protocolID != null ? ci.protocolID : defaultProtocolID
        const keyID = ci.keyID != null ? (ci.keyID as string) : defaultKeyID
        const counterparty = ci.counterparty != null ? (ci.counterparty as string) : defaultCounterparty

        const beef = new Beef()
        beef.mergeBeef((result as any).BEEF as number[])

        const [txid, voutStr] = outpoint.split('.')
        const vout = Number(voutStr)
        const sourceTx = beef.findAtomicTransaction(txid) as Transaction
        const sourceScript = sourceTx.outputs[vout].lockingScript
        const decoded = PushDrop.decode(sourceScript)

        const newKeyID = Utils.toBase64(Random(8))
        const pushdrop = new PushDrop(client)
        const newLockingScript = await pushdrop.lock(
          decoded.fields.map((f: number[]) => Array.from(f)),
          protocolID as [SecurityLevel, string],
          newKeyID,
          to,
          false,
          false
        )

        const inputBEEF = beef.toBinary()
        const response = await client.createAction({
          description: 'Send token via MessageBox',
          inputBEEF,
          inputs: [{
            outpoint,
            inputDescription: 'Token input',
            unlockingScriptLength: 73
          }],
          outputs: [{
            satoshis: 1,
            lockingScript: newLockingScript.toHex(),
            outputDescription: 'Token for recipient'
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
        if (unlockingScript == null || unlockingScript === '') throw new Error('Failed to generate unlocking script')

        const finalResult = await client.signAction({
          reference: signable.reference,
          spends: { 0: { unlockingScript } }
        })

        // Send via MessageBox
        const peerPay = new PeerPayClient({
          walletClient: client as any,
          messageBoxHost: core.defaults.messageBoxHost,
          enableLogging: false
        })
        await peerPay.sendMessage({
          recipient: to,
          messageBox: TOKEN_MESSAGE_BOX,
          body: JSON.stringify({
            transaction: (finalResult as any).tx,
            protocolID,
            keyID: newKeyID,
            sender: core.getIdentityKey(),
            outputIndex: 0
          })
        })

        return {
          txid: (finalResult as any).txid ?? '',
          tx: (finalResult as any).tx
        }
      } catch (error) {
        throw new Error(`Token MessageBox send failed: ${(error as Error).message}`)
      }
    },

    async listIncomingTokens (): Promise<any[]> {
      try {
        const client = core.getClient()
        const peerPay = new PeerPayClient({
          walletClient: client as any,
          messageBoxHost: core.defaults.messageBoxHost,
          enableLogging: false
        })
        const messages = await peerPay.listMessages({
          messageBox: TOKEN_MESSAGE_BOX
        })

        return messages.map((msg: any) => {
          let body = msg.body
          if (typeof body === 'string') {
            try { body = JSON.parse(body) } catch {}
          }
          return {
            messageId: msg.messageId,
            sender: (body?.sender != null ? body.sender : msg.sender) as string,
            transaction: body?.transaction,
            protocolID: body?.protocolID,
            keyID: body?.keyID,
            outputIndex: body?.outputIndex ?? 0,
            createdAt: msg.created_at
          }
        })
      } catch (error) {
        throw new Error(`Failed to list incoming tokens: ${(error as Error).message}`)
      }
    },

    async acceptIncomingToken (token: any, basket?: string): Promise<any> {
      try {
        const client = core.getClient()
        const effectiveBasket = basket ?? core.defaults.tokenBasket

        await client.internalizeAction({
          tx: token.transaction,
          outputs: [{
            outputIndex: token.outputIndex ?? 0,
            protocol: 'basket insertion',
            insertionRemittance: {
              basket: effectiveBasket,
              customInstructions: JSON.stringify({
                protocolID: token.protocolID,
                keyID: token.keyID,
                counterparty: token.sender
              }),
              tags: ['token', 'received']
            }
          }],
          description: `Receive token from ${String(token.sender).substring(0, 20)}...`
        } as any)

        const peerPay = new PeerPayClient({
          walletClient: client as any,
          messageBoxHost: core.defaults.messageBoxHost,
          enableLogging: false
        })
        await peerPay.acknowledgeMessage({ messageIds: [token.messageId] })

        return { accepted: true, basket: effectiveBasket, sender: token.sender }
      } catch (error) {
        throw new Error(`Failed to accept incoming token: ${(error as Error).message}`)
      }
    },

    // ========================================================================
    // New Unified Methods
    // ========================================================================

    async mintToken (options: MintTokenOptions): Promise<MintTokenResult> {
      const standard = options.standard ?? 'pushdrop'
      const adapter = getAdapter(standard)
      try {
        return await adapter.create(core, options as any)
      } catch (error) {
        throw new Error(`Token mint failed (${standard}): ${(error as Error).message}`)
      }
    },

    async listTokens (options?: ListTokensOptions): Promise<UnifiedTokenInfo[]> {
      const basket = options?.basket
      const standard = options?.standard

      try {
        if (standard != null) {
          const adapter = getAdapter(standard)
          const effectiveBasket = basket ?? getDefaultBasket(core, standard)
          return await adapter.list(core, effectiveBasket)
        }

        // If no standard specified, list from the specified basket or all default baskets
        if (basket != null) {
          // List from specified basket, try all adapters and merge
          const results = await Promise.all([
            pushDropAdapter.list(core, basket).catch(() => []),
            ordinalAdapter.list(core, basket).catch(() => []),
            bsv21Adapter.list(core, basket).catch(() => []),
            bsv20Adapter.list(core, basket).catch(() => [])
          ])
          return results.flat()
        }

        // List from all default baskets
        const results = await Promise.all([
          pushDropAdapter.list(core, core.defaults.tokenBasket).catch(() => []),
          ordinalAdapter.list(core, core.defaults.ordinalBasket).catch(() => []),
          bsv21Adapter.list(core, core.defaults.bsv21Basket).catch(() => []),
          bsv20Adapter.list(core, core.defaults.bsv20Basket).catch(() => [])
        ])
        return results.flat()
      } catch (error) {
        throw new Error(`Failed to list tokens: ${(error as Error).message}`)
      }
    },

    async transferToken (options: TransferTokenOptions): Promise<TransactionResult> {
      const standard = options.standard ?? 'pushdrop'
      const adapter = getAdapter(standard)
      try {
        return await adapter.send(core, options)
      } catch (error) {
        throw new Error(`Token transfer failed (${standard}): ${(error as Error).message}`)
      }
    },

    async burnToken (options: BurnTokenOptions): Promise<TransactionResult> {
      const standard = options.standard ?? 'pushdrop'
      const adapter = getAdapter(standard)
      try {
        return await adapter.redeem(core, options)
      } catch (error) {
        throw new Error(`Token burn failed (${standard}): ${(error as Error).message}`)
      }
    },

    // ========================================================================
    // Standard-Specific Convenience Methods
    // ========================================================================

    async inscribeOrdinal (options: InscribeOrdinalOptions): Promise<MintTokenResult> {
      try {
        return await ordinalAdapter.create(core, options)
      } catch (error) {
        throw new Error(`Ordinal inscription failed: ${(error as Error).message}`)
      }
    },

    async deployBsv21 (options: DeployBsv21Options): Promise<MintTokenResult> {
      try {
        return await bsv21Adapter.create(core, options)
      } catch (error) {
        throw new Error(`BSV-21 deploy failed: ${(error as Error).message}`)
      }
    },

    async transferBsv21 (options: TransferBsv21Options): Promise<MintTokenResult> {
      try {
        return await bsv21Adapter.create(core, options)
      } catch (error) {
        throw new Error(`BSV-21 transfer failed: ${(error as Error).message}`)
      }
    },

    async deployBsv20 (options: DeployBsv20Options): Promise<MintTokenResult> {
      try {
        return await bsv20Adapter.create(core, options)
      } catch (error) {
        throw new Error(`BSV-20 deploy failed: ${(error as Error).message}`)
      }
    },

    async mintBsv20 (options: MintBsv20TickerOptions): Promise<MintTokenResult> {
      try {
        return await bsv20Adapter.create(core, options)
      } catch (error) {
        throw new Error(`BSV-20 mint failed: ${(error as Error).message}`)
      }
    },

    async transferBsv20 (options: TransferBsv20Options): Promise<MintTokenResult> {
      try {
        return await bsv20Adapter.create(core, options)
      } catch (error) {
        throw new Error(`BSV-20 transfer failed: ${(error as Error).message}`)
      }
    }
  }
}
