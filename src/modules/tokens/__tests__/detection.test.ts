import { Utils, PrivateKey, P2PKH } from '@bsv/sdk'
import { detectStandard } from '../detection'
import OrdP2PKH from '../templates/ord-p2pkh'

describe('detectStandard', () => {
  it('should detect ordinal NFT from inscription envelope', async () => {
    const key = new PrivateKey(1)
    const address = key.toPublicKey().toAddress()

    const ordP2PKH = new OrdP2PKH()
    const lockingScript = await ordP2PKH.lock({
      address,
      inscription: {
        dataB64: Utils.toBase64(Utils.toArray('Hello World', 'utf8')),
        contentType: 'text/plain'
      }
    })

    const result = detectStandard(lockingScript.toHex())
    expect(result).toBe('ordinal')
  })

  it('should detect BSV-21 deploy+mint token', async () => {
    const key = new PrivateKey(2)
    const address = key.toPublicKey().toAddress()

    const json = JSON.stringify({ p: 'bsv-20', op: 'deploy+mint', amt: '1000000', sym: 'TEST' })
    const dataB64 = Utils.toBase64(Utils.toArray(json, 'utf8'))

    const ordP2PKH = new OrdP2PKH()
    const lockingScript = await ordP2PKH.lock({
      address,
      inscription: { dataB64, contentType: 'application/bsv-20' }
    })

    const result = detectStandard(lockingScript.toHex())
    expect(result).toBe('bsv-21')
  })

  it('should detect BSV-21 transfer (has id field)', async () => {
    const key = new PrivateKey(3)
    const address = key.toPublicKey().toAddress()

    const json = JSON.stringify({ p: 'bsv-20', op: 'transfer', id: 'abc123.0', amt: '500' })
    const dataB64 = Utils.toBase64(Utils.toArray(json, 'utf8'))

    const ordP2PKH = new OrdP2PKH()
    const lockingScript = await ordP2PKH.lock({
      address,
      inscription: { dataB64, contentType: 'application/bsv-20' }
    })

    const result = detectStandard(lockingScript.toHex())
    expect(result).toBe('bsv-21')
  })

  it('should detect BSV-21 token with sym field (no tick)', async () => {
    const key = new PrivateKey(4)
    const address = key.toPublicKey().toAddress()

    const json = JSON.stringify({ p: 'bsv-20', op: 'deploy+mint', amt: '100', sym: 'COOL' })
    const dataB64 = Utils.toBase64(Utils.toArray(json, 'utf8'))

    const ordP2PKH = new OrdP2PKH()
    const lockingScript = await ordP2PKH.lock({
      address,
      inscription: { dataB64, contentType: 'application/bsv-20' }
    })

    const result = detectStandard(lockingScript.toHex())
    expect(result).toBe('bsv-21')
  })

  it('should detect BSV-20 token (has tick field)', async () => {
    const key = new PrivateKey(5)
    const address = key.toPublicKey().toAddress()

    const json = JSON.stringify({ p: 'bsv-20', op: 'deploy', tick: 'PEPE', max: '21000000' })
    const dataB64 = Utils.toBase64(Utils.toArray(json, 'utf8'))

    const ordP2PKH = new OrdP2PKH()
    const lockingScript = await ordP2PKH.lock({
      address,
      inscription: { dataB64, contentType: 'application/bsv-20' }
    })

    const result = detectStandard(lockingScript.toHex())
    expect(result).toBe('bsv-20')
  })

  it('should detect BSV-20 mint (has tick field)', async () => {
    const key = new PrivateKey(6)
    const address = key.toPublicKey().toAddress()

    const json = JSON.stringify({ p: 'bsv-20', op: 'mint', tick: 'PEPE', amt: '1000' })
    const dataB64 = Utils.toBase64(Utils.toArray(json, 'utf8'))

    const ordP2PKH = new OrdP2PKH()
    const lockingScript = await ordP2PKH.lock({
      address,
      inscription: { dataB64, contentType: 'application/bsv-20' }
    })

    const result = detectStandard(lockingScript.toHex())
    expect(result).toBe('bsv-20')
  })

  it('should return null for plain P2PKH script', () => {
    const key = new PrivateKey(7)
    const address = key.toPublicKey().toAddress()
    const lockingScript = new P2PKH().lock(address)

    const result = detectStandard(lockingScript.toHex())
    expect(result).toBeNull()
  })

  it('should return null for empty hex', () => {
    expect(detectStandard('')).toBeNull()
  })

  it('should return null for malformed hex', () => {
    expect(detectStandard('deadbeef')).toBeNull()
  })

  it('should return null for non-bsv-20 ordinal with application/json content type', async () => {
    const key = new PrivateKey(8)
    const address = key.toPublicKey().toAddress()

    const json = JSON.stringify({ hello: 'world' })
    const dataB64 = Utils.toBase64(Utils.toArray(json, 'utf8'))

    const ordP2PKH = new OrdP2PKH()
    const lockingScript = await ordP2PKH.lock({
      address,
      inscription: { dataB64, contentType: 'application/json' }
    })

    // This has an ord envelope but NOT a bsv-20 envelope, so it's an ordinal
    const result = detectStandard(lockingScript.toHex())
    expect(result).toBe('ordinal')
  })
})
