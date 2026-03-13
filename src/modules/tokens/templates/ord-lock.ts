import {
  BigNumber,
  Hash,
  LockingScript,
  OP,
  P2PKH,
  PublicKey,
  Script,
  ScriptTemplate,
  Signature,
  Transaction,
  TransactionSignature,
  UnlockingScript,
  Utils,
  WalletCounterparty,
  WalletInterface,
  WalletProtocol
} from '@bsv/sdk'

const OLOCK_PREFIX =
  '2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff0262102ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382201008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c0000'

const OLOCK_SUFFIX =
  '615179547a75537a537a537a0079537a75527a527a7575615579008763567901c161517957795779210ac407f0e4bd44bfc207355a778b046225a7068fc59ee7eda43ad905aadbffc800206c266b30e6a1319c66dc401e5bd6b432ba49688eecd118297041da8074ce081059795679615679aa0079610079517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01007e81517a75615779567956795679567961537956795479577995939521414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00517951796151795179970079009f63007952799367007968517a75517a75517a7561527a75517a517951795296a0630079527994527a75517a6853798277527982775379012080517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01205279947f7754537993527993013051797e527e54797e58797e527e53797e52797e57797e0079517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a756100795779ac517a75517a75517a75517a75517a75517a75517a75517a75517a7561517a75517a756169587951797e58797eaa577961007982775179517958947f7551790128947f77517a75517a75618777777777777777777767557951876351795779a9876957795779ac777777777777777767006868'

const toHex = (str: string): string => {
  return Utils.toHex(Utils.toArray(str))
}

function buildOutput (satoshis: number, script: number[]): number[] {
  const writer = new Utils.Writer()
  writer.writeUInt64LEBn(new BigNumber(satoshis))
  writer.writeVarIntNum(script.length)
  writer.write(script)
  return writer.toArray()
}

export interface OrdLockLockParams {
  ordAddress: string
  payAddress: string
  price: number
  assetId: string
  itemData?: Record<string, any>
  metadata?: Record<string, any>
}

export interface OrdLockCancelUnlockParams {
  protocolID?: WalletProtocol
  keyID?: string
  counterparty?: WalletCounterparty
  signOutputs?: 'all' | 'none' | 'single'
  anyoneCanPay?: boolean
  sourceSatoshis?: number
  lockingScript?: Script
}

export interface OrdLockPurchaseUnlockParams {
  sourceSatoshis?: number
  lockingScript?: Script
}

export type OrdLockUnlockParams =
  | ({ kind?: 'cancel' } & OrdLockCancelUnlockParams)
  | ({ kind: 'purchase' } & OrdLockPurchaseUnlockParams)

/**
 * OrdLock (order lock) template for marketplace listings.
 * Browser-safe port from bsv-wallet-helper.
 */
export default class OrdLock implements ScriptTemplate {
  private readonly wallet?: WalletInterface

  constructor (wallet?: WalletInterface) {
    this.wallet = wallet
  }

  async lock (params: OrdLockLockParams): Promise<LockingScript> {
    if (!params || typeof params !== 'object') {
      throw new Error('params is required')
    }
    if (!params.ordAddress || typeof params.ordAddress !== 'string') {
      throw new Error('ordAddress is required and must be a string')
    }
    if (!params.payAddress || typeof params.payAddress !== 'string') {
      throw new Error('payAddress is required and must be a string')
    }
    if (!Number.isSafeInteger(params.price) || params.price < 1) {
      throw new Error('price is required and must be an integer greater than 0')
    }
    if (!params.assetId || typeof params.assetId !== 'string') {
      throw new Error('assetId is required and must be a string')
    }

    const cancelPkh = Utils.fromBase58Check(params.ordAddress).data as number[]
    const payPkh = Utils.fromBase58Check(params.payAddress).data as number[]

    const inscription = {
      p: 'bsv-20',
      op: 'transfer',
      amt: 1,
      id: params.assetId
    }

    const combinedMetadata = {
      ...(params.metadata ?? {}),
      ...(params.itemData ?? {})
    }

    const inscriptionJsonHex = toHex(JSON.stringify(inscription))
    const prefixAsm = Script.fromHex(OLOCK_PREFIX).toASM()
    const suffixAsm = Script.fromHex(OLOCK_SUFFIX).toASM()

    const payLockingScript = new P2PKH().lock(params.payAddress)
    const payOutputBytes = buildOutput(params.price, payLockingScript.toBinary())
    const payOutputHex = Utils.toHex(payOutputBytes)

    const cancelPkhHex = Utils.toHex(cancelPkh)
    const contentTypeHex = toHex('application/bsv-20')

    const asmParts = [
      'OP_0', 'OP_IF', toHex('ord'), 'OP_1', contentTypeHex, 'OP_0',
      inscriptionJsonHex, 'OP_ENDIF',
      prefixAsm, cancelPkhHex, payOutputHex, suffixAsm
    ]

    if (Object.keys(combinedMetadata).length > 0) {
      const metadataJsonHex = toHex(JSON.stringify(combinedMetadata))
      asmParts.push('OP_RETURN', metadataJsonHex)
    }

    return LockingScript.fromASM(asmParts.join(' '))
  }

  unlock (params?: OrdLockUnlockParams) {
    if (params && (params as any).kind === 'purchase') {
      return this.purchaseUnlock(params as OrdLockPurchaseUnlockParams)
    }
    return this.cancelUnlock(params as OrdLockCancelUnlockParams)
  }

  cancelUnlock (params?: OrdLockCancelUnlockParams): {
    sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
    estimateLength: () => Promise<108>
  } {
    if (this.wallet == null) {
      throw new Error('Wallet is required for cancel unlocking')
    }

    const protocolID = params?.protocolID ?? ([0, 'ordlock'] as WalletProtocol)
    const keyID = params?.keyID ?? '0'
    const counterparty = (params?.counterparty ?? 'self') as WalletCounterparty
    const signOutputs = params?.signOutputs ?? 'all'
    const anyoneCanPay = params?.anyoneCanPay ?? false
    const sourceSatoshis = params?.sourceSatoshis
    const scriptOverride = params?.lockingScript

    const wallet = this.wallet

    return {
      sign: async (tx: Transaction, inputIndex: number) => {
        let signatureScope = TransactionSignature.SIGHASH_FORKID
        if (signOutputs === 'all') signatureScope |= TransactionSignature.SIGHASH_ALL
        if (signOutputs === 'none') signatureScope |= TransactionSignature.SIGHASH_NONE
        if (signOutputs === 'single') signatureScope |= TransactionSignature.SIGHASH_SINGLE
        if (anyoneCanPay) signatureScope |= TransactionSignature.SIGHASH_ANYONECANPAY

        const input = tx.inputs[inputIndex]
        const otherInputs = anyoneCanPay ? [] : tx.inputs.filter((_, i) => i !== inputIndex)
        const sourceTXID = input.sourceTXID || input.sourceTransaction?.id('hex')
        const sats = sourceSatoshis ?? input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis
        const ls = scriptOverride ?? input.sourceTransaction?.outputs[input.sourceOutputIndex].lockingScript

        const preimage = TransactionSignature.format({
          sourceTXID: sourceTXID!,
          sourceOutputIndex: input.sourceOutputIndex,
          sourceSatoshis: sats!,
          transactionVersion: tx.version,
          otherInputs,
          inputIndex,
          outputs: tx.outputs,
          inputSequence: input.sequence || 0xffffffff,
          subscript: ls!,
          lockTime: tx.lockTime,
          scope: signatureScope
        })

        const { signature } = await wallet.createSignature({
          hashToDirectlySign: Hash.hash256(preimage),
          protocolID,
          keyID,
          counterparty
        })

        const { publicKey } = await wallet.getPublicKey({
          protocolID,
          keyID,
          counterparty,
          forSelf: true
        })

        const rawSignature = Signature.fromDER(signature, 'hex')
        const sig = new TransactionSignature(rawSignature.r, rawSignature.s, signatureScope)
        const sigForScript = sig.toChecksigFormat()
        const pubkeyForScript = PublicKey.fromString(publicKey).encode(true) as number[]

        const unlockScript = new UnlockingScript()
        unlockScript.writeBin(sigForScript)
        unlockScript.writeBin(pubkeyForScript)
        unlockScript.writeOpCode(OP.OP_1)

        return unlockScript
      },
      estimateLength: async () => 108
    }
  }

  purchaseUnlock (params?: OrdLockPurchaseUnlockParams): {
    sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
    estimateLength: (tx: Transaction, inputIndex: number) => Promise<number>
  } {
    const sourceSatoshis = params?.sourceSatoshis
    const scriptOverride = params?.lockingScript

    const purchase = {
      sign: async (tx: Transaction, inputIndex: number) => {
        if (tx.outputs.length < 2) {
          throw new Error('Malformed transaction')
        }

        const output0 = buildOutput(
          tx.outputs[0].satoshis || 0,
          tx.outputs[0].lockingScript.toBinary()
        )

        let otherOutputs: number[] | undefined
        if (tx.outputs.length > 2) {
          const writer = new Utils.Writer()
          for (const output of tx.outputs.slice(2)) {
            writer.write(buildOutput(output.satoshis || 0, output.lockingScript.toBinary()))
          }
          otherOutputs = writer.toArray()
        }

        const input = tx.inputs[inputIndex]
        const otherInputs = tx.inputs.filter((_, i) => i !== inputIndex)
        const sourceTXID = input.sourceTXID || input.sourceTransaction?.id('hex')
        const sats = sourceSatoshis ?? input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis
        const ls = scriptOverride ?? input.sourceTransaction?.outputs[input.sourceOutputIndex].lockingScript

        let signatureScope = TransactionSignature.SIGHASH_FORKID | TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_ANYONECANPAY

        const preimage = TransactionSignature.format({
          sourceTXID: sourceTXID!,
          sourceOutputIndex: input.sourceOutputIndex,
          sourceSatoshis: sats!,
          transactionVersion: tx.version,
          otherInputs: [],
          inputIndex,
          outputs: tx.outputs,
          inputSequence: input.sequence || 0xffffffff,
          subscript: ls!,
          lockTime: tx.lockTime,
          scope: signatureScope
        })

        const unlockingScript = new UnlockingScript()
        unlockingScript.writeBin(output0)
        if (otherOutputs != null && otherOutputs.length > 0) {
          unlockingScript.writeBin(otherOutputs)
        } else {
          unlockingScript.writeOpCode(OP.OP_0)
        }
        unlockingScript.writeBin(preimage)
        unlockingScript.writeOpCode(OP.OP_0)

        return unlockingScript
      },
      estimateLength: async (tx: Transaction, inputIndex: number) => {
        return (await purchase.sign(tx, inputIndex)).toBinary().length
      }
    }

    return purchase
  }
}
