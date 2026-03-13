import { PrivateKey, Utils } from '@bsv/sdk'
import OrdP2PKH, { applyInscription, type Inscription, type MAP } from '../ord-p2pkh'

describe('OrdP2PKH (browser-safe)', () => {
  describe('lock', () => {
    it('should create a valid P2PKH locking script from publicKey', async () => {
      const privateKey = new PrivateKey(1)
      const publicKey = privateKey.toPublicKey().toString()

      const ordP2pkh = new OrdP2PKH()
      const lockingScript = await ordP2pkh.lock({ publicKey })

      const asm = lockingScript.toASM()
      expect(asm).toContain('OP_DUP')
      expect(asm).toContain('OP_HASH160')
      expect(asm).toContain('OP_EQUALVERIFY')
      expect(asm).toContain('OP_CHECKSIG')
    })

    it('should create a valid P2PKH locking script from address', async () => {
      const privateKey = new PrivateKey(1)
      const address = privateKey.toPublicKey().toAddress()

      const ordP2pkh = new OrdP2PKH()
      const lockingScript = await ordP2pkh.lock({ address })

      const asm = lockingScript.toASM()
      expect(asm).toContain('OP_DUP')
      expect(asm).toContain('OP_CHECKSIG')
    })

    it('should create locking script with inscription', async () => {
      const privateKey = new PrivateKey(2)
      const publicKey = privateKey.toPublicKey().toString()

      const inscription: Inscription = {
        dataB64: Utils.toBase64(Utils.toArray('Hello, World!', 'utf8')),
        contentType: 'text/plain'
      }

      const ordP2pkh = new OrdP2PKH()
      const lockingScript = await ordP2pkh.lock({ publicKey, inscription })

      const asm = lockingScript.toASM()
      expect(asm).toContain('OP_0')
      expect(asm).toContain('OP_IF')
      expect(asm).toContain('OP_ENDIF')
      expect(asm).toContain('OP_DUP')
      expect(asm).toContain('OP_CHECKSIG')
    })

    it('should create locking script with MAP metadata', async () => {
      const privateKey = new PrivateKey(3)
      const publicKey = privateKey.toPublicKey().toString()

      const metadata: MAP = {
        app: 'testapp',
        type: 'profile',
        name: 'test-user'
      }

      const ordP2pkh = new OrdP2PKH()
      const lockingScript = await ordP2pkh.lock({ publicKey, metadata })

      const asm = lockingScript.toASM()
      expect(asm).toContain('OP_RETURN')
      expect(asm).toContain('OP_DUP')
      expect(asm).toContain('OP_CHECKSIG')
    })

    it('should create locking script with both inscription and metadata', async () => {
      const privateKey = new PrivateKey(4)
      const publicKey = privateKey.toPublicKey().toString()

      const inscription: Inscription = {
        dataB64: Utils.toBase64(Utils.toArray('Test data', 'utf8')),
        contentType: 'image/png'
      }

      const metadata: MAP = {
        app: 'gallery',
        type: 'artwork',
        artist: 'satoshi'
      }

      const ordP2pkh = new OrdP2PKH()
      const lockingScript = await ordP2pkh.lock({ publicKey, inscription, metadata })

      const asm = lockingScript.toASM()
      expect(asm).toContain('OP_IF')
      expect(asm).toContain('OP_DUP')
      expect(asm).toContain('OP_RETURN')
    })

    it('should throw for missing publicKey/address', async () => {
      const ordP2pkh = new OrdP2PKH()
      await expect(ordP2pkh.lock({} as any)).rejects.toThrow('One of address or publicKey is required')
    })

    it('should throw for null params', async () => {
      const ordP2pkh = new OrdP2PKH()
      await expect(ordP2pkh.lock(null as any)).rejects.toThrow('Lock params are required')
    })

    it('should reject MAP metadata without required type field', async () => {
      const privateKey = new PrivateKey(5)
      const publicKey = privateKey.toPublicKey().toString()

      const invalidMetaData = { app: 'testapp' } as MAP

      const ordP2pkh = new OrdP2PKH()
      await expect(ordP2pkh.lock({ publicKey, metadata: invalidMetaData }))
        .rejects.toThrow('metadata.type is required and must be a string')
    })

    it('should reject invalid inscription (missing dataB64)', async () => {
      const privateKey = new PrivateKey(6)
      const publicKey = privateKey.toPublicKey().toString()

      await expect(new OrdP2PKH().lock({
        publicKey,
        inscription: { dataB64: '', contentType: 'text/plain' }
      })).rejects.toThrow('inscription.dataB64 is required')
    })
  })

  describe('applyInscription', () => {
    it('should apply inscription to an existing locking script', async () => {
      const { P2PKH, PublicKey } = await import('@bsv/sdk')
      const privateKey = new PrivateKey(10)
      const address = privateKey.toPublicKey().toAddress()
      const baseLockingScript = new P2PKH().lock(address)

      const inscription: Inscription = {
        dataB64: Utils.toBase64(Utils.toArray('test inscription', 'utf8')),
        contentType: 'text/plain'
      }

      const result = applyInscription(baseLockingScript, inscription)
      const asm = result.toASM()

      expect(asm).toContain('OP_0')
      expect(asm).toContain('OP_IF')
      expect(asm).toContain('OP_ENDIF')
      expect(asm).toContain('OP_DUP')
    })

    it('should return unchanged script when no inscription or metadata', async () => {
      const { P2PKH } = await import('@bsv/sdk')
      const privateKey = new PrivateKey(11)
      const address = privateKey.toPublicKey().toAddress()
      const baseLockingScript = new P2PKH().lock(address)

      const result = applyInscription(baseLockingScript)
      expect(result.toHex()).toBe(baseLockingScript.toHex())
    })

    it('should throw for MAP metadata with missing required fields', async () => {
      const { P2PKH } = await import('@bsv/sdk')
      const privateKey = new PrivateKey(12)
      const address = privateKey.toPublicKey().toAddress()
      const baseLockingScript = new P2PKH().lock(address)

      const invalidMap = { app: 'test' } as MAP
      expect(() => applyInscription(baseLockingScript, undefined, invalidMap))
        .toThrow('MAP.app and MAP.type are required fields')
    })
  })

  describe('unlock', () => {
    it('should throw without wallet', () => {
      const ordP2pkh = new OrdP2PKH()
      expect(() => ordP2pkh.unlock()).toThrow('Wallet is required for unlocking')
    })

    it('should return estimateLength of 108', async () => {
      // Create a minimal mock wallet
      const mockWallet = {
        createSignature: jest.fn(),
        getPublicKey: jest.fn()
      } as any

      const ordP2pkh = new OrdP2PKH(mockWallet)
      const unlockTemplate = ordP2pkh.unlock()
      const length = await unlockTemplate.estimateLength()
      expect(length).toBe(108)
    })
  })
})
