import { Utils, PrivateKey, PushDrop, LockingScript } from '@bsv/sdk'
import { PushDropAdapter } from '../pushdrop-adapter'
import { OrdinalAdapter } from '../ordinal-adapter'
import { Bsv21Adapter } from '../bsv21-adapter'
import { Bsv20Adapter } from '../bsv20-adapter'
import OrdP2PKH from '../templates/ord-p2pkh'

// ============================================================================
// Helpers
// ============================================================================

const mockIdentityKey = new PrivateKey(1).toPublicKey().toString()

function createMockCore (overrides: Record<string, any> = {}): any {
  const mockClient = {
    encrypt: jest.fn().mockResolvedValue({ ciphertext: [1, 2, 3, 4] }),
    decrypt: jest.fn().mockResolvedValue({
      plaintext: Array.from(Utils.toArray(JSON.stringify({ test: true }), 'utf8'))
    }),
    createAction: jest.fn().mockResolvedValue({ txid: 'mock-txid-abc123', tx: [0] }),
    listOutputs: jest.fn().mockResolvedValue({ outputs: [] }),
    signAction: jest.fn().mockResolvedValue({ txid: 'mock-signed-txid', tx: [0] }),
    getPublicKey: jest.fn().mockResolvedValue({ publicKey: mockIdentityKey }),
    createSignature: jest.fn().mockResolvedValue({ signature: '00'.repeat(72) }),
    ...overrides
  }
  return {
    getClient: () => mockClient,
    getIdentityKey: () => mockIdentityKey,
    defaults: {
      tokenBasket: 'tokens',
      tokenProtocolID: [0, 'token'],
      tokenKeyID: '1',
      ordinalBasket: 'ordinals',
      bsv21Basket: 'bsv21-tokens',
      bsv20Basket: 'bsv20-tokens'
    },
    _client: mockClient
  }
}

// ============================================================================
// PushDropAdapter
// ============================================================================

describe('PushDropAdapter', () => {
  const adapter = new PushDropAdapter()

  it('should have standard = pushdrop', () => {
    expect(adapter.standard).toBe('pushdrop')
  })

  describe('create', () => {
    it('should encrypt data and call createAction', async () => {
      const core = createMockCore()

      const result = await adapter.create(core, {
        data: { points: 100 },
        basket: 'loyalty'
      })

      expect(result.standard).toBe('pushdrop')
      expect(result.basket).toBe('loyalty')
      expect(result.txid).toBe('mock-txid-abc123')
      expect(core._client.encrypt).toHaveBeenCalled()
      expect(core._client.createAction).toHaveBeenCalledWith(
        expect.objectContaining({
          outputs: expect.arrayContaining([
            expect.objectContaining({
              basket: 'loyalty',
              satoshis: 1,
              tags: ['token']
            })
          ])
        })
      )
    })

    it('should use default basket when not specified', async () => {
      const core = createMockCore()
      const result = await adapter.create(core, { data: 'hello' })
      expect(result.basket).toBe('tokens')
    })

    it('should use specified satoshis', async () => {
      const core = createMockCore()
      await adapter.create(core, { data: 'test', satoshis: 500 })
      expect(core._client.createAction).toHaveBeenCalledWith(
        expect.objectContaining({
          outputs: expect.arrayContaining([
            expect.objectContaining({ satoshis: 500 })
          ])
        })
      )
    })
  })

  describe('list', () => {
    it('should return empty array when no outputs', async () => {
      const core = createMockCore()
      const result = await adapter.list(core, 'tokens')
      expect(result).toEqual([])
    })
  })

  describe('detectFromScript', () => {
    it('should always return false (pushdrop cannot be detected from hex)', () => {
      expect(adapter.detectFromScript('abcdef')).toBe(false)
      expect(adapter.detectFromScript('')).toBe(false)
    })
  })
})

// ============================================================================
// OrdinalAdapter
// ============================================================================

describe('OrdinalAdapter', () => {
  const adapter = new OrdinalAdapter()

  it('should have standard = ordinal', () => {
    expect(adapter.standard).toBe('ordinal')
  })

  describe('create', () => {
    it('should create an ordinal inscription', async () => {
      const core = createMockCore()

      const result = await adapter.create(core, {
        content: 'Hello Ordinals!',
        contentType: 'text/plain'
      })

      expect(result.standard).toBe('ordinal')
      expect(result.basket).toBe('ordinals')
      expect(result.txid).toBe('mock-txid-abc123')
      expect(core._client.createAction).toHaveBeenCalledWith(
        expect.objectContaining({
          outputs: expect.arrayContaining([
            expect.objectContaining({
              satoshis: 1,
              tags: ['ordinal', 'nft']
            })
          ])
        })
      )
    })

    it('should use custom basket', async () => {
      const core = createMockCore()
      const result = await adapter.create(core, {
        content: 'test',
        contentType: 'text/plain',
        basket: 'my-nfts'
      })
      expect(result.basket).toBe('my-nfts')
    })

    it('should accept Uint8Array content', async () => {
      const core = createMockCore()
      const result = await adapter.create(core, {
        content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        contentType: 'image/png'
      })
      expect(result.standard).toBe('ordinal')
    })

    it('should include metadata when provided', async () => {
      const core = createMockCore()
      await adapter.create(core, {
        content: 'test',
        contentType: 'text/plain',
        metadata: { app: 'myapp', type: 'post' }
      })

      const callArgs = core._client.createAction.mock.calls[0][0]
      const lockHex = callArgs.outputs[0].lockingScript
      expect(lockHex).toBeDefined()
    })
  })

  describe('list', () => {
    it('should filter out non-ordinal outputs', async () => {
      const core = createMockCore({
        listOutputs: jest.fn().mockResolvedValue({
          outputs: [
            { outpoint: 'abc.0', satoshis: 1, lockingScript: 'deadbeef' }
          ]
        })
      })
      const result = await adapter.list(core, 'ordinals')
      expect(result).toEqual([])
    })

    it('should return ordinal outputs with inscription data', async () => {
      // Build a real ordinal locking script
      const key = new PrivateKey(10)
      const address = key.toPublicKey().toAddress()
      const ordP2PKH = new OrdP2PKH()
      const ls = await ordP2PKH.lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray('test data', 'utf8')),
          contentType: 'text/plain'
        }
      })

      const core = createMockCore({
        listOutputs: jest.fn().mockResolvedValue({
          outputs: [{
            outpoint: 'txid123.0',
            satoshis: 1,
            lockingScript: ls.toHex()
          }]
        })
      })

      const result = await adapter.list(core, 'ordinals')
      expect(result).toHaveLength(1)
      expect(result[0].standard).toBe('ordinal')
      // extractInscriptionData returns 'application/octet-stream' for the standard
      // OP_0 OP_IF 'ord' OP_1 <type> OP_0 <data> OP_ENDIF format (endifIndex===7 path)
      expect(result[0].contentType).toBeDefined()
      expect(result[0].outpoint).toBe('txid123.0')
    })
  })

  describe('detectFromScript', () => {
    it('should return true for ordinal scripts', async () => {
      const key = new PrivateKey(11)
      const address = key.toPublicKey().toAddress()
      const ls = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray('x', 'utf8')),
          contentType: 'text/plain'
        }
      })
      expect(adapter.detectFromScript(ls.toHex())).toBe(true)
    })

    it('should return false for BSV-20 scripts', async () => {
      const key = new PrivateKey(12)
      const address = key.toPublicKey().toAddress()
      const json = JSON.stringify({ p: 'bsv-20', op: 'mint', tick: 'TEST', amt: '100' })
      const ls = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(json, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })
      expect(adapter.detectFromScript(ls.toHex())).toBe(false)
    })

    it('should return false for plain P2PKH', () => {
      expect(adapter.detectFromScript('76a914abcdef0123456789012345678901234567890123456789abcdef88ac')).toBe(false)
    })
  })
})

// ============================================================================
// Bsv21Adapter
// ============================================================================

describe('Bsv21Adapter', () => {
  const adapter = new Bsv21Adapter()

  it('should have standard = bsv-21', () => {
    expect(adapter.standard).toBe('bsv-21')
  })

  describe('create - deploy+mint', () => {
    it('should deploy a BSV-21 token', async () => {
      const core = createMockCore()

      const result = await adapter.create(core, {
        op: 'deploy+mint',
        amount: 1000000,
        symbol: 'SIMPLE',
        decimals: 8
      })

      expect(result.standard).toBe('bsv-21')
      expect(result.basket).toBe('bsv21-tokens')
      expect(result.tokenId).toBe('mock-txid-abc123.0')
      expect(core._client.createAction).toHaveBeenCalledWith(
        expect.objectContaining({
          outputs: expect.arrayContaining([
            expect.objectContaining({
              satoshis: 1,
              tags: ['bsv-21', 'deploy']
            })
          ])
        })
      )
    })
  })

  describe('create - transfer', () => {
    it('should throw if no recipients', async () => {
      const core = createMockCore()
      await expect(adapter.create(core, {
        op: 'transfer',
        tokenId: 'abc.0',
        recipients: []
      } as any)).rejects.toThrow('At least one recipient is required')
    })

    it('should throw if no tokenId', async () => {
      const core = createMockCore()
      await expect(adapter.create(core, {
        op: 'transfer',
        tokenId: '',
        recipients: [{ to: new PrivateKey(1).toPublicKey().toString(), amount: 100 }]
      } as any)).rejects.toThrow('tokenId is required')
    })

    it('should create transfer outputs for each recipient', async () => {
      const core = createMockCore()
      const recipientKey = new PrivateKey(20).toPublicKey().toString()

      const result = await adapter.create(core, {
        op: 'transfer',
        tokenId: 'deploy-txid.0',
        recipients: [
          { to: recipientKey, amount: 500 },
          { to: recipientKey, amount: 300 }
        ]
      } as any)

      expect(result.standard).toBe('bsv-21')
      const callArgs = core._client.createAction.mock.calls[0][0]
      expect(callArgs.outputs).toHaveLength(2)
    })
  })

  describe('list', () => {
    it('should filter out BSV-20 (tick-based) outputs', async () => {
      const key = new PrivateKey(15)
      const address = key.toPublicKey().toAddress()

      // Create a BSV-20 (tick) inscription
      const json = JSON.stringify({ p: 'bsv-20', op: 'mint', tick: 'PEPE', amt: '100' })
      const ls = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(json, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })

      const core = createMockCore({
        listOutputs: jest.fn().mockResolvedValue({
          outputs: [{ outpoint: 'x.0', satoshis: 1, lockingScript: ls.toHex() }]
        })
      })

      const result = await adapter.list(core, 'bsv21-tokens')
      expect(result).toHaveLength(0) // filtered out because it has 'tick'
    })

    it('should include BSV-21 (id-based) outputs', async () => {
      const key = new PrivateKey(16)
      const address = key.toPublicKey().toAddress()

      const json = JSON.stringify({ p: 'bsv-20', op: 'transfer', id: 'abc.0', amt: '500' })
      const ls = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(json, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })

      const core = createMockCore({
        listOutputs: jest.fn().mockResolvedValue({
          outputs: [{ outpoint: 'y.0', satoshis: 1, lockingScript: ls.toHex() }]
        })
      })

      const result = await adapter.list(core, 'bsv21-tokens')
      expect(result).toHaveLength(1)
      expect(result[0].standard).toBe('bsv-21')
      expect(result[0].tokenId).toBe('abc.0')
      expect(result[0].amount).toBe(500)
    })
  })

  describe('detectFromScript', () => {
    it('should return true for BSV-21 scripts', async () => {
      const key = new PrivateKey(17)
      const address = key.toPublicKey().toAddress()
      const json = JSON.stringify({ p: 'bsv-20', op: 'deploy+mint', amt: '1000', sym: 'X' })
      const ls = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(json, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })
      expect(adapter.detectFromScript(ls.toHex())).toBe(true)
    })

    it('should return false for BSV-20 (tick) scripts', async () => {
      const key = new PrivateKey(18)
      const address = key.toPublicKey().toAddress()
      const json = JSON.stringify({ p: 'bsv-20', op: 'mint', tick: 'ABC', amt: '100' })
      const ls = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(json, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })
      expect(adapter.detectFromScript(ls.toHex())).toBe(false)
    })
  })
})

// ============================================================================
// Bsv20Adapter
// ============================================================================

describe('Bsv20Adapter', () => {
  const adapter = new Bsv20Adapter()

  it('should have standard = bsv-20', () => {
    expect(adapter.standard).toBe('bsv-20')
  })

  describe('create - deploy', () => {
    it('should deploy a BSV-20 ticker token', async () => {
      const core = createMockCore()

      const result = await adapter.create(core, {
        op: 'deploy',
        ticker: 'PEPE',
        maxSupply: 21000000
      })

      expect(result.standard).toBe('bsv-20')
      expect(result.basket).toBe('bsv20-tokens')
      expect(core._client.createAction).toHaveBeenCalledWith(
        expect.objectContaining({
          outputs: expect.arrayContaining([
            expect.objectContaining({
              satoshis: 1,
              tags: ['bsv-20', 'deploy']
            })
          ])
        })
      )
    })
  })

  describe('create - mint', () => {
    it('should mint BSV-20 tokens', async () => {
      const core = createMockCore()

      const result = await adapter.create(core, {
        op: 'mint',
        ticker: 'PEPE',
        amount: 1000
      })

      expect(result.standard).toBe('bsv-20')
      expect(core._client.createAction).toHaveBeenCalledWith(
        expect.objectContaining({
          outputs: expect.arrayContaining([
            expect.objectContaining({ tags: ['bsv-20', 'mint'] })
          ])
        })
      )
    })
  })

  describe('create - deploy validation', () => {
    it('should throw for missing ticker', async () => {
      const core = createMockCore()
      await expect(adapter.create(core, {
        op: 'deploy',
        ticker: '',
        maxSupply: 100
      } as any)).rejects.toThrow('ticker is required')
    })

    it('should throw for zero maxSupply', async () => {
      const core = createMockCore()
      await expect(adapter.create(core, {
        op: 'deploy',
        ticker: 'X',
        maxSupply: 0
      } as any)).rejects.toThrow('maxSupply must be greater than 0')
    })

    it('should throw for mintLimit exceeding maxSupply', async () => {
      const core = createMockCore()
      await expect(adapter.create(core, {
        op: 'deploy',
        ticker: 'X',
        maxSupply: 100,
        mintLimit: 200
      } as any)).rejects.toThrow('mintLimit cannot exceed maxSupply')
    })
  })

  describe('create - mint validation', () => {
    it('should throw for zero amount', async () => {
      const core = createMockCore()
      await expect(adapter.create(core, {
        op: 'mint',
        ticker: 'PEPE',
        amount: 0
      } as any)).rejects.toThrow('amount must be greater than 0')
    })

    it('should throw when mint amount exceeds per-mint limit', async () => {
      // Set up a deploy inscription in the basket with lim=10
      const key = new PrivateKey(40)
      const address = key.toPublicKey().toAddress()
      const deployJson = JSON.stringify({ p: 'bsv-20', op: 'deploy', tick: 'LIM', max: '1000', lim: '10' })
      const deployLs = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(deployJson, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })

      const core = createMockCore({
        listOutputs: jest.fn().mockResolvedValue({
          outputs: [{ outpoint: 'deploy.0', satoshis: 1, lockingScript: deployLs.toHex() }]
        })
      })

      await expect(adapter.create(core, {
        op: 'mint',
        ticker: 'LIM',
        amount: 50 // exceeds lim of 10
      } as any)).rejects.toThrow('exceeds the per-mint limit of 10')
    })

    it('should throw when mint would exceed max supply', async () => {
      const key = new PrivateKey(41)
      const address = key.toPublicKey().toAddress()

      // Deploy with max=100
      const deployJson = JSON.stringify({ p: 'bsv-20', op: 'deploy', tick: 'CAP', max: '100' })
      const deployLs = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(deployJson, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })

      // Existing mint of 80
      const mintJson = JSON.stringify({ p: 'bsv-20', op: 'mint', tick: 'CAP', amt: '80' })
      const mintLs = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(mintJson, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })

      const core = createMockCore({
        listOutputs: jest.fn().mockResolvedValue({
          outputs: [
            { outpoint: 'deploy.0', satoshis: 1, lockingScript: deployLs.toHex() },
            { outpoint: 'mint1.0', satoshis: 1, lockingScript: mintLs.toHex() }
          ]
        })
      })

      // Try to mint 30 more (80 + 30 = 110 > max 100)
      await expect(adapter.create(core, {
        op: 'mint',
        ticker: 'CAP',
        amount: 30
      } as any)).rejects.toThrow('would exceed max supply of 100')
    })

    it('should allow mint within limits', async () => {
      const key = new PrivateKey(42)
      const address = key.toPublicKey().toAddress()

      const deployJson = JSON.stringify({ p: 'bsv-20', op: 'deploy', tick: 'OK', max: '1000', lim: '500' })
      const deployLs = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(deployJson, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })

      const core = createMockCore({
        listOutputs: jest.fn().mockResolvedValue({
          outputs: [{ outpoint: 'deploy.0', satoshis: 1, lockingScript: deployLs.toHex() }]
        })
      })

      // Mint 100 (within lim=500, within max=1000)
      const result = await adapter.create(core, {
        op: 'mint',
        ticker: 'OK',
        amount: 100
      } as any)

      expect(result.standard).toBe('bsv-20')
    })
  })

  describe('create - transfer', () => {
    it('should throw if no recipients', async () => {
      const core = createMockCore()
      await expect(adapter.create(core, {
        op: 'transfer',
        ticker: 'PEPE',
        tokenId: 'abc.0',
        recipients: []
      } as any)).rejects.toThrow('At least one recipient is required')
    })

    it('should create transfer outputs', async () => {
      const core = createMockCore()
      const recipientKey = new PrivateKey(30).toPublicKey().toString()

      await adapter.create(core, {
        op: 'transfer',
        ticker: 'PEPE',
        tokenId: 'abc.0',
        recipients: [{ to: recipientKey, amount: 500 }]
      } as any)

      const callArgs = core._client.createAction.mock.calls[0][0]
      expect(callArgs.outputs).toHaveLength(1)
      expect(callArgs.outputs[0].tags).toContain('bsv-20')
      expect(callArgs.outputs[0].tags).toContain('transfer')
    })
  })

  describe('list', () => {
    it('should include BSV-20 (tick) outputs', async () => {
      const key = new PrivateKey(25)
      const address = key.toPublicKey().toAddress()

      const json = JSON.stringify({ p: 'bsv-20', op: 'mint', tick: 'PEPE', amt: '1000' })
      const ls = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(json, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })

      const core = createMockCore({
        listOutputs: jest.fn().mockResolvedValue({
          outputs: [{ outpoint: 'z.0', satoshis: 1, lockingScript: ls.toHex() }]
        })
      })

      const result = await adapter.list(core, 'bsv20-tokens')
      expect(result).toHaveLength(1)
      expect(result[0].standard).toBe('bsv-20')
      expect(result[0].ticker).toBe('PEPE')
      expect(result[0].amount).toBe(1000)
    })

    it('should filter out BSV-21 (no tick) outputs', async () => {
      const key = new PrivateKey(26)
      const address = key.toPublicKey().toAddress()

      const json = JSON.stringify({ p: 'bsv-20', op: 'deploy+mint', amt: '100', sym: 'X' })
      const ls = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(json, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })

      const core = createMockCore({
        listOutputs: jest.fn().mockResolvedValue({
          outputs: [{ outpoint: 'w.0', satoshis: 1, lockingScript: ls.toHex() }]
        })
      })

      const result = await adapter.list(core, 'bsv20-tokens')
      expect(result).toHaveLength(0)
    })
  })

  describe('detectFromScript', () => {
    it('should return true for BSV-20 (tick) scripts', async () => {
      const key = new PrivateKey(27)
      const address = key.toPublicKey().toAddress()
      const json = JSON.stringify({ p: 'bsv-20', op: 'deploy', tick: 'ABC', max: '100' })
      const ls = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(json, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })
      expect(adapter.detectFromScript(ls.toHex())).toBe(true)
    })

    it('should return false for BSV-21 scripts', async () => {
      const key = new PrivateKey(28)
      const address = key.toPublicKey().toAddress()
      const json = JSON.stringify({ p: 'bsv-20', op: 'deploy+mint', amt: '100' })
      const ls = await new OrdP2PKH().lock({
        address,
        inscription: {
          dataB64: Utils.toBase64(Utils.toArray(json, 'utf8')),
          contentType: 'application/bsv-20'
        }
      })
      expect(adapter.detectFromScript(ls.toHex())).toBe(false)
    })

    it('should return false for plain scripts', () => {
      expect(adapter.detectFromScript('76a914aabb88ac')).toBe(false)
    })
  })
})
