import {
  LockingScript,
  Utils,
  Script,
  WalletInterface,
  ScriptTemplate,
  Transaction,
  UnlockingScript,
  P2PKH,
  PublicKey,
  Hash,
  Signature,
  TransactionSignature,
  WalletProtocol,
  WalletCounterparty,
  OP
} from '@bsv/sdk'

export const ORDINAL_MAP_PREFIX = '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5'

export interface Inscription {
  dataB64: string
  contentType: string
}

export interface MAP {
  app: string
  type: string
  [prop: string]: string
}

const toHex = (str: string): string => {
  return Utils.toHex(Utils.toArray(str))
}

export interface OrdP2PKHLockParams {
  address?: string
  publicKey?: string
  inscription?: Inscription
  metadata?: MAP
}

export interface OrdP2PKHUnlockParams {
  protocolID?: WalletProtocol
  keyID?: string
  counterparty?: WalletCounterparty
  signOutputs?: 'all' | 'none' | 'single'
  anyoneCanPay?: boolean
  sourceSatoshis?: number
  lockingScript?: Script
}

/**
 * OrdP2PKH (1Sat Ordinal + Pay To Public Key Hash) script template.
 *
 * Creates P2PKH locking scripts with 1Sat Ordinal inscription envelopes
 * and optional MAP metadata. Browser-safe (no Buffer usage).
 */
export default class OrdP2PKH implements ScriptTemplate {
  private readonly wallet?: WalletInterface

  constructor (wallet?: WalletInterface) {
    this.wallet = wallet
  }

  async lock (params: OrdP2PKHLockParams): Promise<LockingScript> {
    if (!params || typeof params !== 'object') {
      throw new Error('Lock params are required')
    }

    if (params.inscription !== undefined) {
      if (typeof params.inscription !== 'object' || params.inscription === null) {
        throw new Error('inscription must be an object with dataB64 and contentType properties')
      }
      if (!params.inscription.dataB64 || typeof params.inscription.dataB64 !== 'string') {
        throw new Error('inscription.dataB64 is required and must be a base64 string')
      }
      if (!params.inscription.contentType || typeof params.inscription.contentType !== 'string') {
        throw new Error('inscription.contentType is required and must be a string (MIME type)')
      }
    }

    if (params.metadata !== undefined) {
      if (typeof params.metadata !== 'object' || params.metadata === null) {
        throw new Error('metadata must be an object')
      }
      if (!params.metadata.app || typeof params.metadata.app !== 'string') {
        throw new Error('metadata.app is required and must be a string')
      }
      if (!params.metadata.type || typeof params.metadata.type !== 'string') {
        throw new Error('metadata.type is required and must be a string')
      }
    }

    let lockingScript: LockingScript

    if (params.address != null) {
      lockingScript = new P2PKH().lock(params.address)
    } else if (params.publicKey != null) {
      lockingScript = new P2PKH().lock(PublicKey.fromString(params.publicKey).toAddress())
    } else {
      throw new Error('One of address or publicKey is required')
    }

    return applyInscription(lockingScript, params.inscription, params.metadata)
  }

  unlock (params?: OrdP2PKHUnlockParams): {
    sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
    estimateLength: () => Promise<108>
  } {
    if (this.wallet == null) {
      throw new Error('Wallet is required for unlocking')
    }

    const protocolID = params?.protocolID ?? [2, 'ordp2pkh'] as WalletProtocol
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

        return new UnlockingScript([
          { op: sigForScript.length, data: sigForScript },
          { op: pubkeyForScript.length, data: pubkeyForScript }
        ])
      },
      estimateLength: async () => 108
    }
  }
}

/**
 * Applies ordinal inscription and MAP metadata to a P2PKH locking script.
 * Browser-safe: uses Utils instead of Buffer.
 */
export const applyInscription = (
  lockingScript: LockingScript,
  inscription?: Inscription,
  metaData?: MAP,
  withSeparator = false
): LockingScript => {
  let ordAsm = ''

  if (inscription?.dataB64 !== undefined && inscription?.contentType !== undefined) {
    const ordHex = toHex('ord')
    const fileBytes = Utils.toArray(inscription.dataB64, 'base64')
    const fileHex = Utils.toHex(fileBytes).trim()
    if (!fileHex) {
      throw new Error('Invalid file data')
    }
    const fileMediaType = toHex(inscription.contentType)
    if (!fileMediaType) {
      throw new Error('Invalid media type')
    }
    ordAsm = `OP_0 OP_IF ${ordHex} OP_1 ${fileMediaType} OP_0 ${fileHex} OP_ENDIF`
  }

  let inscriptionAsm = `${ordAsm ? `${ordAsm} ${withSeparator ? 'OP_CODESEPARATOR ' : ''}` : ''}${lockingScript.toASM()}`

  if ((metaData != null) && (!metaData.app || !metaData.type)) {
    throw new Error('MAP.app and MAP.type are required fields')
  }

  if (metaData?.app && metaData?.type) {
    const mapPrefixHex = toHex(ORDINAL_MAP_PREFIX)
    const mapCmdValue = toHex('SET')
    inscriptionAsm = `${inscriptionAsm ? `${inscriptionAsm} ` : ''}OP_RETURN ${mapPrefixHex} ${mapCmdValue}`

    for (const [key, value] of Object.entries(metaData)) {
      if (key !== 'cmd') {
        inscriptionAsm = `${inscriptionAsm} ${toHex(key)} ${toHex(value)}`
      }
    }
  }

  return LockingScript.fromASM(inscriptionAsm)
}
