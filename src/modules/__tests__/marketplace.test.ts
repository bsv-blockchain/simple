import { PrivateKey, PublicKey, P2PKH } from '@bsv/sdk'
import { createMarketplaceMethods } from '../marketplace'

function createMockCore (): any {
  const mockClient = {
    createAction: jest.fn().mockResolvedValue({
      signableTransaction: {
        tx: [],
        reference: 'mock-ref'
      }
    }),
    listOutputs: jest.fn().mockResolvedValue({
      outputs: [],
      BEEF: []
    }),
    signAction: jest.fn().mockResolvedValue({ txid: 'mock-signed-txid', tx: [0] }),
    createSignature: jest.fn(),
    getPublicKey: jest.fn()
  }

  return {
    getClient: () => mockClient,
    getIdentityKey: () => new PrivateKey(1).toPublicKey().toString(),
    defaults: {
      tokenBasket: 'tokens',
      ordinalBasket: 'ordinals'
    },
    _client: mockClient
  }
}

describe('createMarketplaceMethods', () => {
  it('should return all three marketplace methods', () => {
    const core = createMockCore()
    const methods = createMarketplaceMethods(core)

    expect(methods).toHaveProperty('listOrdinalForSale')
    expect(methods).toHaveProperty('purchaseOrdinal')
    expect(methods).toHaveProperty('cancelOrdinalListing')
    expect(typeof methods.listOrdinalForSale).toBe('function')
    expect(typeof methods.purchaseOrdinal).toBe('function')
    expect(typeof methods.cancelOrdinalListing).toBe('function')
  })

  describe('listOrdinalForSale', () => {
    it('should throw when ordinal not found', async () => {
      const core = createMockCore()
      core._client.listOutputs.mockResolvedValue({ outputs: [], BEEF: [] })
      const methods = createMarketplaceMethods(core)

      await expect(methods.listOrdinalForSale({
        basket: 'ordinals',
        outpoint: 'nonexistent.0',
        price: 10000
      })).rejects.toThrow('Ordinal not found')
    })
  })

  describe('purchaseOrdinal', () => {
    it('should throw when listing not found', async () => {
      const core = createMockCore()
      core._client.listOutputs.mockResolvedValue({ outputs: [], BEEF: [] })
      const methods = createMarketplaceMethods(core)

      await expect(methods.purchaseOrdinal({
        listingOutpoint: 'nonexistent.0'
      })).rejects.toThrow('Listing not found')
    })
  })

  describe('cancelOrdinalListing', () => {
    it('should throw when listing not found', async () => {
      const core = createMockCore()
      core._client.listOutputs.mockResolvedValue({ outputs: [], BEEF: [] })
      const methods = createMarketplaceMethods(core)

      await expect(methods.cancelOrdinalListing({
        listingOutpoint: 'nonexistent.0'
      })).rejects.toThrow('Listing not found')
    })
  })
})
