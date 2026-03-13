import { LockingScript, Script, Utils } from '@bsv/sdk'
import { ORDINAL_MAP_PREFIX } from './ord-p2pkh'

export type ScriptType = 'P2PKH' | 'Ordinal' | 'OpReturn' | 'Custom'

export interface InscriptionData {
  dataB64: string
  contentType: string
}

export interface MAP {
  app: string
  type: string
  [key: string]: string
}

const toHex = (str: string): string => Utils.toHex(Utils.toArray(str))

function getHex (input: LockingScript | Script | string): string {
  if (typeof input === 'string') return input
  return input.toHex()
}

// OP_0 OP_IF 'ord' = 0063036f7264
const ORD_ENVELOPE_MARKER = '0063036f7264'

// BSV-20 specific: OP_0 OP_IF 'ord' OP_1 'application/bsv-20' OP_0
const BSV20_ENVELOPE_START = '0063036f726451126170706c69636174696f6e2f6273762d323000'

/**
 * Checks if a script contains an ordinal inscription envelope (OP_0 OP_IF 'ord' ...).
 * This is a general check - works for any content type, not just BSV-20.
 */
export function hasOrdEnvelope (input: LockingScript | Script | string): boolean {
  try {
    const hex = getHex(input)
    return hex.includes(ORD_ENVELOPE_MARKER)
  } catch {
    return false
  }
}

/**
 * Checks if a script contains a BSV-20 specific ordinal envelope.
 */
export function hasBsv20Envelope (input: LockingScript | Script | string): boolean {
  try {
    const hex = getHex(input)
    return hex.includes(BSV20_ENVELOPE_START)
  } catch {
    return false
  }
}

/**
 * Checks if a script is a standard P2PKH script.
 */
export function isP2PKH (input: LockingScript | Script | string): boolean {
  try {
    const hex = getHex(input)
    // P2PKH: OP_DUP(76) OP_HASH160(a9) OP_PUSHBYTES_20(14) [20 bytes] OP_EQUALVERIFY(88) OP_CHECKSIG(ac)
    return hex.length === 50 && hex.startsWith('76a914') && hex.endsWith('88ac') && hex.substring(4, 6) === '14'
  } catch {
    return false
  }
}

/**
 * Checks if a script is an ordinal inscription + P2PKH (any content type).
 */
export function isOrdinal (input: LockingScript | Script | string): boolean {
  try {
    const hex = getHex(input)
    if (!hasOrdEnvelope(hex)) return false
    const p2pkhPattern = /76a914[0-9a-fA-F]{40}88ac/
    return p2pkhPattern.test(hex)
  } catch {
    return false
  }
}

/**
 * Checks if a hex string contains OP_RETURN data.
 */
export function hasOpReturnData (input: LockingScript | Script | string): boolean {
  try {
    if (typeof input === 'string') {
      try {
        const script = Script.fromHex(input)
        if (script.toASM().includes('OP_RETURN')) return true
      } catch {}
      if (input.startsWith('6a')) return true
      const patterns = [/88ac6a/, /686a/, /ae6a/]
      return patterns.some(p => p.test(input))
    }
    return input.toASM().includes('OP_RETURN')
  } catch {
    return false
  }
}

/**
 * Determines the type of a script.
 */
export function getScriptType (input: LockingScript | Script | string): ScriptType {
  try {
    if (isOrdinal(input)) return 'Ordinal'
    if (isP2PKH(input)) return 'P2PKH'
    if (hasOpReturnData(input)) {
      const hex = getHex(input)
      if (hex.startsWith('6a')) return 'OpReturn'
    }
    return 'Custom'
  } catch {
    return 'Custom'
  }
}

/**
 * Extracts inscription data from an ordinal envelope script.
 * Browser-safe: uses Utils instead of Buffer.
 */
export function extractInscriptionData (input: LockingScript | Script | string): InscriptionData | null {
  if (!hasOrdEnvelope(input)) return null

  const script = typeof input === 'string' ? Script.fromHex(input) : input
  const chunks = script.chunks

  const endifIndex = chunks.findIndex(chunk => chunk.op === 0x68) // OP_ENDIF
  if (endifIndex === -1) return null

  let contentType: string
  let dataB64: string

  if (endifIndex === 9) {
    // Full format: OP_0 OP_IF 'ord' OP_1 <mediaType> OP_0 <contentType> OP_0 <data> OP_ENDIF
    const contentTypeChunk = chunks[6]
    if (!contentTypeChunk?.data?.length) return null
    contentType = Utils.toUTF8(contentTypeChunk.data)

    const dataChunk = chunks[8]
    if (!dataChunk?.data?.length) return null
    dataB64 = Utils.toBase64(dataChunk.data)
  } else if (endifIndex === 7) {
    // Short format: OP_0 OP_IF 'ord' OP_1 <mediaType> OP_0 <data> OP_ENDIF
    const dataChunk = chunks[6]
    if (!dataChunk?.data?.length) return null
    contentType = 'application/octet-stream'
    dataB64 = Utils.toBase64(dataChunk.data)
  } else {
    return null
  }

  return { dataB64, contentType }
}

/**
 * Extracts MAP metadata from a script containing OP_RETURN fields.
 */
export function extractMapMetadata (input: LockingScript | Script | string): MAP | null {
  if (!hasOpReturnData(input)) return null

  const script = typeof input === 'string' ? Script.fromHex(input) : input
  const chunks = script.chunks

  const opReturnIndex = chunks.findIndex(chunk => chunk.op === 0x6a)
  if (opReturnIndex === -1) return null

  const prefixChunk = chunks[opReturnIndex + 1]
  if (!prefixChunk?.data?.length) return null

  let prefix: string
  try { prefix = Utils.toUTF8(prefixChunk.data) } catch { return null }
  if (prefix !== ORDINAL_MAP_PREFIX) return null

  const cmdChunk = chunks[opReturnIndex + 2]
  if (!cmdChunk?.data?.length) return null

  let cmd: string
  try { cmd = Utils.toUTF8(cmdChunk.data) } catch { return null }
  if (cmd !== 'SET') return null

  const metadata: any = {}
  let currentIndex = opReturnIndex + 3

  while (currentIndex < chunks.length - 1) {
    const keyChunk = chunks[currentIndex]
    const valueChunk = chunks[currentIndex + 1]
    if (!keyChunk?.data || !valueChunk?.data) break
    try {
      metadata[Utils.toUTF8(keyChunk.data)] = Utils.toUTF8(valueChunk.data)
    } catch { break }
    currentIndex += 2
  }

  if (!metadata.app || !metadata.type) return null
  return metadata as MAP
}
