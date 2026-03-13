import { PrivateKey, Script } from '@bsv/sdk'
import OrdLock from '../ord-lock'

describe('OrdLock (browser-safe)', () => {
  describe('lock', () => {
    it('should create a script containing ord envelope', async () => {
      const ordLock = new OrdLock()

      const lockingScript = await ordLock.lock({
        ordAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        payAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        price: 1000,
        assetId: 'abcd_0'
      })

      const asm = lockingScript.toASM()
      expect(asm).toContain('OP_IF')
      expect(asm).toContain('OP_ENDIF')
    })

    it('should include OP_RETURN when metadata is provided', async () => {
      const ordLock = new OrdLock()

      const lockingScript = await ordLock.lock({
        ordAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        payAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        price: 1000,
        assetId: 'abcd_0',
        metadata: { app: 'test', type: 'ord' },
        itemData: { lootTableId: 'test' }
      })

      const asm = lockingScript.toASM()
      expect(asm).toContain('OP_IF')
      expect(asm).toContain('OP_RETURN')
    })

    it('should not include OP_RETURN when no metadata', async () => {
      const ordLock = new OrdLock()

      const lockingScript = await ordLock.lock({
        ordAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        payAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        price: 500,
        assetId: 'xyz_1'
      })

      const asm = lockingScript.toASM()
      expect(asm).toContain('OP_IF')
      expect(asm).not.toContain('OP_RETURN')
    })

    it('should throw for missing ordAddress', async () => {
      const ordLock = new OrdLock()
      await expect(ordLock.lock({
        ordAddress: '',
        payAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        price: 1000,
        assetId: 'abc'
      })).rejects.toThrow('ordAddress is required')
    })

    it('should throw for missing payAddress', async () => {
      const ordLock = new OrdLock()
      await expect(ordLock.lock({
        ordAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        payAddress: '',
        price: 1000,
        assetId: 'abc'
      })).rejects.toThrow('payAddress is required')
    })

    it('should throw for invalid price', async () => {
      const ordLock = new OrdLock()
      await expect(ordLock.lock({
        ordAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        payAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        price: 0,
        assetId: 'abc'
      })).rejects.toThrow('price is required and must be an integer greater than 0')
    })

    it('should throw for missing assetId', async () => {
      const ordLock = new OrdLock()
      await expect(ordLock.lock({
        ordAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        payAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        price: 1000,
        assetId: ''
      })).rejects.toThrow('assetId is required')
    })

    it('should throw for null params', async () => {
      const ordLock = new OrdLock()
      await expect(ordLock.lock(null as any)).rejects.toThrow('params is required')
    })
  })

  describe('unlock', () => {
    it('should throw without wallet for cancelUnlock', () => {
      const ordLock = new OrdLock()
      expect(() => ordLock.cancelUnlock()).toThrow('Wallet is required for cancel unlocking')
    })

    it('should return estimateLength of 108 for cancelUnlock', async () => {
      const mockWallet = {
        createSignature: jest.fn(),
        getPublicKey: jest.fn()
      } as any

      const ordLock = new OrdLock(mockWallet)
      const unlock = ordLock.cancelUnlock()
      expect(await unlock.estimateLength()).toBe(108)
    })

    it('should dispatch to cancelUnlock by default', () => {
      const mockWallet = {
        createSignature: jest.fn(),
        getPublicKey: jest.fn()
      } as any

      const ordLock = new OrdLock(mockWallet)
      const unlock = ordLock.unlock()
      expect(unlock).toHaveProperty('sign')
      expect(unlock).toHaveProperty('estimateLength')
    })

    it('should dispatch to purchaseUnlock when kind is purchase', () => {
      const ordLock = new OrdLock()
      const unlock = ordLock.unlock({ kind: 'purchase' })
      expect(unlock).toHaveProperty('sign')
      expect(unlock).toHaveProperty('estimateLength')
    })
  })
})
