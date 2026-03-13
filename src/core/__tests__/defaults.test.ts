import { DEFAULT_CONFIG, mergeDefaults } from '../defaults'

describe('defaults', () => {
  describe('DEFAULT_CONFIG', () => {
    it('should have ordinalBasket default', () => {
      expect(DEFAULT_CONFIG.ordinalBasket).toBe('ordinals')
    })

    it('should have bsv21Basket default', () => {
      expect(DEFAULT_CONFIG.bsv21Basket).toBe('bsv21-tokens')
    })

    it('should have bsv20Basket default', () => {
      expect(DEFAULT_CONFIG.bsv20Basket).toBe('bsv20-tokens')
    })

    it('should have existing defaults unchanged', () => {
      expect(DEFAULT_CONFIG.network).toBe('main')
      expect(DEFAULT_CONFIG.tokenBasket).toBe('tokens')
      expect(DEFAULT_CONFIG.tokenProtocolID).toEqual([0, 'token'])
      expect(DEFAULT_CONFIG.tokenKeyID).toBe('1')
    })
  })

  describe('mergeDefaults', () => {
    it('should override specific fields', () => {
      const merged = mergeDefaults({ ordinalBasket: 'my-ordinals' })
      expect(merged.ordinalBasket).toBe('my-ordinals')
      expect(merged.bsv21Basket).toBe('bsv21-tokens')
    })

    it('should return full config when given empty object', () => {
      const merged = mergeDefaults({})
      expect(merged).toEqual(DEFAULT_CONFIG)
    })
  })
})
