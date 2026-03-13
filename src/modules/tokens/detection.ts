import { TokenStandard } from './types'
import {
  hasOrdEnvelope,
  hasBsv20Envelope,
  isP2PKH,
  isOrdinal
} from './templates/script-validation'

/**
 * Detects the token standard from a locking script hex string.
 * Returns null if no known token standard is detected.
 */
export function detectStandard (lockingScriptHex: string): TokenStandard | null {
  // Check for BSV-20 envelope (also covers BSV-21 which uses same envelope format)
  if (hasBsv20Envelope(lockingScriptHex)) {
    // Parse the inscription JSON to distinguish bsv-20 vs bsv-21
    const standard = detectBsvTokenStandard(lockingScriptHex)
    if (standard != null) return standard
  }

  // General ordinal envelope (non-BSV-20 content type) = 1Sat Ordinal NFT
  if (hasOrdEnvelope(lockingScriptHex)) {
    return 'ordinal'
  }

  // PushDrop tokens don't have a deterministic script prefix we can detect
  // from raw hex without attempting decode. Return null and let caller
  // fall back to 'pushdrop' if the output is in a known PushDrop basket.
  return null
}

/**
 * Attempts to distinguish between BSV-20 (ticker-based) and BSV-21 (tickerless)
 * by parsing the inscription JSON data from the ordinal envelope.
 */
function detectBsvTokenStandard (lockingScriptHex: string): TokenStandard | null {
  try {
    // The inscription JSON is embedded after the content type push in the envelope.
    // BSV-20 envelope: OP_0 OP_IF 'ord' OP_1 'application/bsv-20' OP_0 <json> OP_ENDIF ...
    // The hex for the content type 'application/bsv-20' is followed by OP_0 (00) then the JSON data.
    const envelopeStart = lockingScriptHex.indexOf('0063036f726451126170706c69636174696f6e2f6273762d323000')
    if (envelopeStart === -1) return null

    // After the BSV-20 envelope header, the next bytes are the JSON data push
    const afterHeader = lockingScriptHex.substring(
      envelopeStart + '0063036f726451126170706c69636174696f6e2f6273762d323000'.length
    )

    // Read the push data length (varint)
    const { data: jsonBytes } = readPushData(afterHeader)
    if (jsonBytes == null) return null

    const jsonStr = new TextDecoder().decode(new Uint8Array(jsonBytes))
    const parsed = JSON.parse(jsonStr)

    if (parsed.p === 'bsv-20') {
      // BSV-20 v1 uses 'tick' field for ticker-based tokens
      // BSV-21 uses 'id' field (and has no 'tick')
      if (parsed.tick != null) return 'bsv-20'
      if (parsed.id != null || parsed.op === 'deploy+mint') return 'bsv-21'
      // If it's a deploy op with 'sym' but no 'tick', it's BSV-21
      if (parsed.sym != null) return 'bsv-21'
      // Default to bsv-20 if p=bsv-20 but can't distinguish
      return 'bsv-20'
    }

    return null
  } catch {
    return null
  }
}

/**
 * Reads a push data element from hex, handling standard Bitcoin push opcodes.
 */
function readPushData (hex: string): { data: number[] | null; consumed: number } {
  if (hex.length < 2) return { data: null, consumed: 0 }

  const firstByte = parseInt(hex.substring(0, 2), 16)

  if (firstByte >= 0x01 && firstByte <= 0x4b) {
    // Direct push: firstByte is the length
    const dataHex = hex.substring(2, 2 + firstByte * 2)
    if (dataHex.length < firstByte * 2) return { data: null, consumed: 0 }
    const bytes: number[] = []
    for (let i = 0; i < dataHex.length; i += 2) {
      bytes.push(parseInt(dataHex.substring(i, i + 2), 16))
    }
    return { data: bytes, consumed: 2 + firstByte * 2 }
  }

  if (firstByte === 0x4c) {
    // OP_PUSHDATA1
    const len = parseInt(hex.substring(2, 4), 16)
    const dataHex = hex.substring(4, 4 + len * 2)
    if (dataHex.length < len * 2) return { data: null, consumed: 0 }
    const bytes: number[] = []
    for (let i = 0; i < dataHex.length; i += 2) {
      bytes.push(parseInt(dataHex.substring(i, i + 2), 16))
    }
    return { data: bytes, consumed: 4 + len * 2 }
  }

  if (firstByte === 0x4d) {
    // OP_PUSHDATA2
    const len = parseInt(hex.substring(4, 6) + hex.substring(2, 4), 16) // little-endian
    const dataHex = hex.substring(6, 6 + len * 2)
    if (dataHex.length < len * 2) return { data: null, consumed: 0 }
    const bytes: number[] = []
    for (let i = 0; i < dataHex.length; i += 2) {
      bytes.push(parseInt(dataHex.substring(i, i + 2), 16))
    }
    return { data: bytes, consumed: 6 + len * 2 }
  }

  return { data: null, consumed: 0 }
}
