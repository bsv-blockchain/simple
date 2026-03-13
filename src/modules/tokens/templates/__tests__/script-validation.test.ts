import { LockingScript, OP, Utils } from '@bsv/sdk'
import {
  isP2PKH,
  isOrdinal,
  hasOrdEnvelope,
  hasBsv20Envelope,
  hasOpReturnData,
  getScriptType,
  extractInscriptionData,
  extractMapMetadata
} from '../script-validation'
import { ORDINAL_MAP_PREFIX } from '../ord-p2pkh'

describe('Script Validation (browser-safe templates)', () => {
  // ========================================================================
  // isP2PKH
  // ========================================================================

  describe('isP2PKH', () => {
    it('should return true for a standard P2PKH script', () => {
      const script = new LockingScript([
        { op: OP.OP_DUP },
        { op: OP.OP_HASH160 },
        { op: 20, data: new Array(20).fill(0xAB) },
        { op: OP.OP_EQUALVERIFY },
        { op: OP.OP_CHECKSIG }
      ])
      expect(isP2PKH(script)).toBe(true)
    })

    it('should return true for valid P2PKH hex string', () => {
      const hex = '76a914' + 'ab'.repeat(20) + '88ac'
      expect(isP2PKH(hex)).toBe(true)
    })

    it('should return false for a short script', () => {
      const script = new LockingScript([
        { op: OP.OP_DUP },
        { op: OP.OP_HASH160 }
      ])
      expect(isP2PKH(script)).toBe(false)
    })

    it('should return false for wrong hash length (19 bytes)', () => {
      const hex = '76a913' + 'ab'.repeat(19) + '88ac'
      expect(isP2PKH(hex)).toBe(false)
    })

    it('should return false for wrong suffix', () => {
      const hex = '76a914' + 'ab'.repeat(20) + '88ad'
      expect(isP2PKH(hex)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isP2PKH('')).toBe(false)
    })

    it('should return false for ordinal + P2PKH', () => {
      const ordHex = '0063036f726451126170706c69636174696f6e2f6273762d323000'
      const p2pkhHex = '76a914' + 'ab'.repeat(20) + '88ac'
      expect(isP2PKH(ordHex + '05' + '1122334455' + '68' + p2pkhHex)).toBe(false)
    })
  })

  // ========================================================================
  // hasOrdEnvelope
  // ========================================================================

  describe('hasOrdEnvelope', () => {
    it('should return true for script containing ordinal envelope', () => {
      // OP_0 OP_IF 'ord' = 0063036f7264 ...
      const ordinalHex = '0063036f726451126170706c69636174696f6e2f6273762d323000' + '05' + '68656c6c6f' + '68'
      const script = LockingScript.fromHex(ordinalHex)
      expect(hasOrdEnvelope(script)).toBe(true)
    })

    it('should return true for hex with ordinal envelope', () => {
      const hex = '0063036f726451126170706c69636174696f6e2f6273762d323000' + '05' + '68656c6c6f' + '68'
      expect(hasOrdEnvelope(hex)).toBe(true)
    })

    it('should return false for plain P2PKH', () => {
      const hex = '76a914' + 'ab'.repeat(20) + '88ac'
      expect(hasOrdEnvelope(hex)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(hasOrdEnvelope('')).toBe(false)
    })

    it('should return true for non-BSV-20 ordinal envelope', () => {
      // OP_0 OP_IF 'ord' OP_1 'text/plain' OP_0 <data> OP_ENDIF P2PKH
      // Build the hex for a text/plain inscription
      const ordPrefix = '0063036f7264' // OP_0 OP_IF 'ord'
      const textPlainHex = Utils.toHex(Utils.toArray('text/plain'))
      expect(hasOrdEnvelope(ordPrefix + '51' + '0a' + textPlainHex)).toBe(true)
    })
  })

  // ========================================================================
  // hasBsv20Envelope
  // ========================================================================

  describe('hasBsv20Envelope', () => {
    it('should return true for BSV-20 envelope', () => {
      const hex = '0063036f726451126170706c69636174696f6e2f6273762d323000' + '05' + '68656c6c6f' + '68'
      expect(hasBsv20Envelope(hex)).toBe(true)
    })

    it('should return false for general ordinal (non-BSV-20 content type)', () => {
      // OP_0 OP_IF 'ord' OP_1 'text/plain' ... - NOT BSV-20
      const ordPrefix = '0063036f7264' // OP_0 OP_IF 'ord'
      expect(hasBsv20Envelope(ordPrefix + '51' + '0a' + Utils.toHex(Utils.toArray('text/plain')))).toBe(false)
    })

    it('should return false for plain P2PKH', () => {
      expect(hasBsv20Envelope('76a914' + 'ab'.repeat(20) + '88ac')).toBe(false)
    })
  })

  // ========================================================================
  // isOrdinal
  // ========================================================================

  describe('isOrdinal', () => {
    it('should return true for ordinal envelope + P2PKH', () => {
      const ordHex = '0063036f726451126170706c69636174696f6e2f6273762d323000'
      const p2pkhHex = '76a914' + 'ab'.repeat(20) + '88ac'
      const fullHex = ordHex + '05' + '68656c6c6f' + '68' + p2pkhHex
      expect(isOrdinal(fullHex)).toBe(true)
    })

    it('should return false for ordinal envelope without P2PKH', () => {
      const ordHex = '0063036f726451126170706c69636174696f6e2f6273762d323000' + '05' + '68656c6c6f' + '68'
      expect(isOrdinal(ordHex)).toBe(false)
    })

    it('should return false for P2PKH without ordinal', () => {
      const hex = '76a914' + 'ab'.repeat(20) + '88ac'
      expect(isOrdinal(hex)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isOrdinal('')).toBe(false)
    })

    it('should work with LockingScript objects', () => {
      const ordHex = '0063036f726451126170706c69636174696f6e2f6273762d323000'
      const p2pkhHex = '76a914' + 'ab'.repeat(20) + '88ac'
      const fullHex = ordHex + '05' + '68656c6c6f' + '68' + p2pkhHex
      const script = LockingScript.fromHex(fullHex)
      expect(isOrdinal(script)).toBe(true)
    })
  })

  // ========================================================================
  // hasOpReturnData
  // ========================================================================

  describe('hasOpReturnData', () => {
    it('should return true for script with OP_RETURN', () => {
      const script = new LockingScript([
        { op: OP.OP_RETURN },
        { op: 5, data: [0x48, 0x65, 0x6c, 0x6c, 0x6f] }
      ])
      expect(hasOpReturnData(script)).toBe(true)
    })

    it('should return false for P2PKH without OP_RETURN', () => {
      const script = new LockingScript([
        { op: OP.OP_DUP },
        { op: OP.OP_HASH160 },
        { op: 20, data: new Array(20).fill(0xAB) },
        { op: OP.OP_EQUALVERIFY },
        { op: OP.OP_CHECKSIG }
      ])
      expect(hasOpReturnData(script)).toBe(false)
    })

    it('should return true for hex starting with OP_RETURN', () => {
      expect(hasOpReturnData('6a' + '05' + '48656c6c6f')).toBe(true)
    })

    it('should return true for P2PKH followed by OP_RETURN', () => {
      const p2pkhHex = '76a914' + 'ab'.repeat(20) + '88ac'
      expect(hasOpReturnData(p2pkhHex + '6a' + '05' + '48656c6c6f')).toBe(true)
    })

    it('should return false for empty string', () => {
      expect(hasOpReturnData('')).toBe(false)
    })
  })

  // ========================================================================
  // getScriptType
  // ========================================================================

  describe('getScriptType', () => {
    it('should return P2PKH for standard P2PKH', () => {
      const script = new LockingScript([
        { op: OP.OP_DUP },
        { op: OP.OP_HASH160 },
        { op: 20, data: new Array(20).fill(0xAB) },
        { op: OP.OP_EQUALVERIFY },
        { op: OP.OP_CHECKSIG }
      ])
      expect(getScriptType(script)).toBe('P2PKH')
    })

    it('should return Ordinal for BSV-20 Ordinal + P2PKH', () => {
      const ordHex = '0063036f726451126170706c69636174696f6e2f6273762d323000'
      const p2pkhHex = '76a914' + 'ab'.repeat(20) + '88ac'
      expect(getScriptType(ordHex + '05' + '68656c6c6f' + '68' + p2pkhHex)).toBe('Ordinal')
    })

    it('should return OpReturn for pure OP_RETURN script', () => {
      const script = new LockingScript([
        { op: OP.OP_RETURN },
        { op: 5, data: [0x48, 0x65, 0x6c, 0x6c, 0x6f] }
      ])
      expect(getScriptType(script)).toBe('OpReturn')
    })

    it('should return Custom for unrecognized scripts', () => {
      expect(getScriptType('deadbeef12345678')).toBe('Custom')
    })
  })

  // ========================================================================
  // extractInscriptionData
  // ========================================================================

  describe('extractInscriptionData', () => {
    it('should extract inscription with content type (OP_ENDIF at position 9)', () => {
      const contentType = Utils.toArray('text/plain')
      const data = Utils.toArray('Hello World')

      const script = new LockingScript([
        { op: 0x00 },
        { op: 0x63 },
        { op: 3, data: Utils.toArray('ord') },
        { op: 0x51 },
        { op: 18, data: Utils.toArray('application/bsv-20') },
        { op: 0x00 },
        { op: contentType.length, data: contentType },
        { op: 0x00 },
        { op: data.length, data: data },
        { op: 0x68 },
        { op: OP.OP_DUP },
        { op: OP.OP_HASH160 },
        { op: 20, data: new Array(20).fill(0xAB) },
        { op: OP.OP_EQUALVERIFY },
        { op: OP.OP_CHECKSIG }
      ])

      const inscription = extractInscriptionData(script)
      expect(inscription).not.toBeNull()
      expect(inscription!.contentType).toBe('text/plain')

      const decoded = new TextDecoder().decode(new Uint8Array(Utils.toArray(inscription!.dataB64, 'base64')))
      expect(decoded).toBe('Hello World')
    })

    it('should extract inscription without content type (OP_ENDIF at position 7)', () => {
      const data = Utils.toArray('Hello World')

      const script = new LockingScript([
        { op: 0x00 },
        { op: 0x63 },
        { op: 3, data: Utils.toArray('ord') },
        { op: 0x51 },
        { op: 18, data: Utils.toArray('application/bsv-20') },
        { op: 0x00 },
        { op: data.length, data: data },
        { op: 0x68 },
        { op: OP.OP_DUP },
        { op: OP.OP_HASH160 },
        { op: 20, data: new Array(20).fill(0xAB) },
        { op: OP.OP_EQUALVERIFY },
        { op: OP.OP_CHECKSIG }
      ])

      const inscription = extractInscriptionData(script)
      expect(inscription).not.toBeNull()
      expect(inscription!.contentType).toBe('application/octet-stream')
    })

    it('should return null for non-ordinal script', () => {
      const script = new LockingScript([
        { op: OP.OP_DUP },
        { op: OP.OP_HASH160 },
        { op: 20, data: new Array(20).fill(0xAB) },
        { op: OP.OP_EQUALVERIFY },
        { op: OP.OP_CHECKSIG }
      ])
      expect(extractInscriptionData(script)).toBeNull()
    })

    it('should return null for missing OP_ENDIF', () => {
      const script = new LockingScript([
        { op: 0x00 },
        { op: 0x63 },
        { op: 3, data: Utils.toArray('ord') },
        { op: 0x51 },
        { op: 18, data: Utils.toArray('application/bsv-20') },
        { op: 0x00 }
      ])
      // No ordinal envelope marker will be in the hex without a proper envelope structure,
      // so this should return null
      expect(extractInscriptionData(script)).toBeNull()
    })

    it('should work with hex string input', () => {
      // Plain P2PKH hex — no ordinal
      const hex = '76a914' + 'ab'.repeat(20) + '88ac'
      expect(extractInscriptionData(hex)).toBeNull()
    })
  })

  // ========================================================================
  // extractMapMetadata
  // ========================================================================

  describe('extractMapMetadata', () => {
    it('should extract MAP metadata from script with OP_RETURN', () => {
      const baseScript = new LockingScript([
        { op: OP.OP_DUP },
        { op: OP.OP_HASH160 },
        { op: 20, data: new Array(20).fill(0xAB) },
        { op: OP.OP_EQUALVERIFY },
        { op: OP.OP_CHECKSIG }
      ])

      const mapPrefix = Utils.toArray(ORDINAL_MAP_PREFIX)
      const setCmd = Utils.toArray('SET')
      const appKey = Utils.toArray('app')
      const appValue = Utils.toArray('my-app')
      const typeKey = Utils.toArray('type')
      const typeValue = Utils.toArray('data')

      const scriptWithMap = new LockingScript([
        ...baseScript.chunks,
        { op: OP.OP_RETURN },
        { op: mapPrefix.length, data: mapPrefix },
        { op: setCmd.length, data: setCmd },
        { op: appKey.length, data: appKey },
        { op: appValue.length, data: appValue },
        { op: typeKey.length, data: typeKey },
        { op: typeValue.length, data: typeValue }
      ])

      const metadata = extractMapMetadata(scriptWithMap)
      expect(metadata).not.toBeNull()
      expect(metadata!.app).toBe('my-app')
      expect(metadata!.type).toBe('data')
    })

    it('should return null for script without OP_RETURN', () => {
      const script = new LockingScript([
        { op: OP.OP_DUP },
        { op: OP.OP_HASH160 },
        { op: 20, data: new Array(20).fill(0xAB) },
        { op: OP.OP_EQUALVERIFY },
        { op: OP.OP_CHECKSIG }
      ])
      expect(extractMapMetadata(script)).toBeNull()
    })

    it('should return null for OP_RETURN without MAP prefix', () => {
      const script = new LockingScript([
        { op: OP.OP_RETURN },
        { op: 5, data: Utils.toArray('Hello') }
      ])
      expect(extractMapMetadata(script)).toBeNull()
    })

    it('should return null for MAP without required app/type fields', () => {
      const mapPrefix = Utils.toArray(ORDINAL_MAP_PREFIX)
      const setCmd = Utils.toArray('SET')
      const fooKey = Utils.toArray('foo')
      const fooValue = Utils.toArray('bar')

      const script = new LockingScript([
        { op: OP.OP_RETURN },
        { op: mapPrefix.length, data: mapPrefix },
        { op: setCmd.length, data: setCmd },
        { op: fooKey.length, data: fooKey },
        { op: fooValue.length, data: fooValue }
      ])
      expect(extractMapMetadata(script)).toBeNull()
    })
  })

  // ========================================================================
  // Combined scenarios
  // ========================================================================

  describe('combined scenarios', () => {
    it('should handle malformed hex gracefully', () => {
      expect(isP2PKH('deadbeef')).toBe(false)
      expect(isOrdinal('deadbeef')).toBe(false)
      expect(hasOrdEnvelope('deadbeef')).toBe(false)
      expect(hasBsv20Envelope('deadbeef')).toBe(false)
      expect(hasOpReturnData('deadbeef')).toBe(false)
      expect(getScriptType('deadbeef')).toBe('Custom')
    })

    it('should correctly classify ordinal + P2PKH as Ordinal', () => {
      const ordHex = '0063036f726451126170706c69636174696f6e2f6273762d323000'
      const p2pkhHex = '76a914' + 'ab'.repeat(20) + '88ac'
      const fullHex = ordHex + '05' + '68656c6c6f' + '68' + p2pkhHex
      const script = LockingScript.fromHex(fullHex)

      expect(isP2PKH(script)).toBe(false)
      expect(hasOrdEnvelope(script)).toBe(true)
      expect(hasBsv20Envelope(script)).toBe(true)
      expect(isOrdinal(script)).toBe(true)
      expect(getScriptType(script)).toBe('Ordinal')
    })
  })
})
