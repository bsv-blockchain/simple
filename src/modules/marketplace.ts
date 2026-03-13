import {
  PublicKey,
  Transaction,
  Beef,
  P2PKH,
  WalletProtocol,
  WalletCounterparty
} from '@bsv/sdk'
import { WalletCore } from '../core/WalletCore'
import { TransactionResult } from '../core/types'
import OrdLock from './tokens/templates/ord-lock'
import OrdP2PKH from './tokens/templates/ord-p2pkh'
import {
  ListForSaleOptions,
  PurchaseOrdinalOptions,
  CancelListingOptions
} from './tokens/types'

const MARKETPLACE_BASKET = 'marketplace-listings'

export function createMarketplaceMethods (core: WalletCore): {
  listOrdinalForSale: (options: ListForSaleOptions) => Promise<TransactionResult>
  purchaseOrdinal: (options: PurchaseOrdinalOptions) => Promise<TransactionResult>
  cancelOrdinalListing: (options: CancelListingOptions) => Promise<TransactionResult>
} {
  return {
    async listOrdinalForSale (options: ListForSaleOptions): Promise<TransactionResult> {
      try {
        const client = core.getClient()
        const { basket, outpoint, price, assetId, metadata } = options

        // Get the source ordinal output
        const result = await client.listOutputs({
          basket,
          include: 'entire transactions',
          includeCustomInstructions: true
        } as any)

        const outputs = result?.outputs ?? []
        const targetOutput = outputs.find((o: any) => o.outpoint === outpoint)
        if (targetOutput == null) throw new Error(`Ordinal not found: ${outpoint}`)

        // Parse stored derivation params from the ordinal output
        let ci: any = {}
        if ((targetOutput as any).customInstructions != null) {
          try { ci = JSON.parse((targetOutput as any).customInstructions as string) } catch {}
        }
        const unlockProtocolID = ci.protocolID ?? [2, 'ordp2pkh']
        const unlockKeyID = ci.keyID ?? '0'
        const unlockCounterparty = ci.counterparty ?? 'self'

        const beef = new Beef()
        beef.mergeBeef((result as any).BEEF as number[])

        const sellerAddress = PublicKey.fromString(core.getIdentityKey()).toAddress()
        const effectiveAssetId = assetId ?? outpoint

        // Create OrdLock locking script
        const ordLock = new OrdLock(client)
        const lockingScript = await ordLock.lock({
          ordAddress: sellerAddress,
          payAddress: sellerAddress,
          price,
          assetId: effectiveAssetId,
          metadata
        })

        const inputBEEF = beef.toBinary()
        const response = await client.createAction({
          description: options.description ?? `List ordinal for sale at ${price} sats`,
          inputBEEF,
          inputs: [{
            outpoint,
            inputDescription: 'Ordinal to list',
            unlockingScriptLength: 108
          }],
          outputs: [{
            satoshis: 1,
            lockingScript: lockingScript.toHex(),
            outputDescription: 'OrdLock listing',
            basket: MARKETPLACE_BASKET,
            customInstructions: JSON.stringify({
              standard: 'ordlock',
              price,
              assetId: effectiveAssetId,
              sellerAddress,
              sourceBasket: basket
            }),
            tags: ['marketplace', 'listing']
          }],
          options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
        } as any)

        if ((response as any)?.signableTransaction == null) {
          throw new Error('Expected signableTransaction')
        }

        const signable = (response as any).signableTransaction
        const txToSign = Transaction.fromBEEF(signable.tx)

        // Unlock the ordinal input using the derivation params from when it was locked
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
      } catch (error) {
        throw new Error(`Failed to list ordinal for sale: ${(error as Error).message}`)
      }
    },

    async purchaseOrdinal (options: PurchaseOrdinalOptions): Promise<TransactionResult> {
      try {
        const client = core.getClient()
        const { listingOutpoint } = options
        const basket = options.basket ?? MARKETPLACE_BASKET

        const result = await client.listOutputs({
          basket,
          include: 'entire transactions',
          includeCustomInstructions: true
        } as any)

        const outputs = result?.outputs ?? []
        const targetOutput = outputs.find((o: any) => o.outpoint === listingOutpoint)
        if (targetOutput == null) throw new Error(`Listing not found: ${listingOutpoint}`)

        let ci: any = {}
        if ((targetOutput as any).customInstructions != null) {
          try { ci = JSON.parse((targetOutput as any).customInstructions as string) } catch {}
        }

        const beef = new Beef()
        beef.mergeBeef((result as any).BEEF as number[])

        // Build buyer's output (ordinal goes to buyer)
        const buyerAddress = PublicKey.fromString(core.getIdentityKey()).toAddress()
        const buyerLockingScript = new P2PKH().lock(buyerAddress)

        const inputBEEF = beef.toBinary()

        const response = await client.createAction({
          description: options.description ?? 'Purchase ordinal',
          inputBEEF,
          inputs: [{
            outpoint: listingOutpoint,
            inputDescription: 'OrdLock listing',
            unlockingScriptLength: 500
          }],
          outputs: [{
            satoshis: 1,
            lockingScript: buyerLockingScript.toHex(),
            outputDescription: 'Ordinal to buyer',
            basket: ci.sourceBasket ?? 'ordinals',
            tags: ['ordinal', 'purchased']
          }],
          options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
        } as any)

        if ((response as any)?.signableTransaction == null) {
          throw new Error('Expected signableTransaction')
        }

        const signable = (response as any).signableTransaction
        const txToSign = Transaction.fromBEEF(signable.tx)

        const ordLock = new OrdLock(client)
        txToSign.inputs[0].unlockingScriptTemplate = ordLock.unlock({ kind: 'purchase' })
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
      } catch (error) {
        throw new Error(`Failed to purchase ordinal: ${(error as Error).message}`)
      }
    },

    async cancelOrdinalListing (options: CancelListingOptions): Promise<TransactionResult> {
      try {
        const client = core.getClient()
        const { listingOutpoint } = options
        const basket = options.basket ?? MARKETPLACE_BASKET

        const result = await client.listOutputs({
          basket,
          include: 'entire transactions',
          includeCustomInstructions: true
        } as any)

        const outputs = result?.outputs ?? []
        const targetOutput = outputs.find((o: any) => o.outpoint === listingOutpoint)
        if (targetOutput == null) throw new Error(`Listing not found: ${listingOutpoint}`)

        let ci: any = {}
        if ((targetOutput as any).customInstructions != null) {
          try { ci = JSON.parse((targetOutput as any).customInstructions as string) } catch {}
        }

        const beef = new Beef()
        beef.mergeBeef((result as any).BEEF as number[])

        // Return ordinal to seller
        const sellerAddress = PublicKey.fromString(core.getIdentityKey()).toAddress()
        const sellerLockingScript = new P2PKH().lock(sellerAddress)

        const inputBEEF = beef.toBinary()
        const response = await client.createAction({
          description: options.description ?? 'Cancel ordinal listing',
          inputBEEF,
          inputs: [{
            outpoint: listingOutpoint,
            inputDescription: 'OrdLock listing to cancel',
            unlockingScriptLength: 108
          }],
          outputs: [{
            satoshis: 1,
            lockingScript: sellerLockingScript.toHex(),
            outputDescription: 'Ordinal returned to seller',
            basket: ci.sourceBasket ?? 'ordinals',
            tags: ['ordinal', 'cancelled']
          }],
          options: { randomizeOutputs: false, acceptDelayedBroadcast: false }
        } as any)

        if ((response as any)?.signableTransaction == null) {
          throw new Error('Expected signableTransaction')
        }

        const signable = (response as any).signableTransaction
        const txToSign = Transaction.fromBEEF(signable.tx)

        const ordLock = new OrdLock(client)
        txToSign.inputs[0].unlockingScriptTemplate = ordLock.cancelUnlock()
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
      } catch (error) {
        throw new Error(`Failed to cancel ordinal listing: ${(error as Error).message}`)
      }
    }
  }
}
