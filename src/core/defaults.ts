import { SecurityLevel } from '@bsv/sdk'
import { WalletDefaults } from './types'

export const DEFAULT_CONFIG: WalletDefaults = {
  network: 'main',
  description: 'BSV-Simplify transaction',
  outputDescription: 'BSV-Simplify output',
  changeBasket: undefined,
  tokenBasket: 'tokens',
  tokenProtocolID: [0 as SecurityLevel, 'token'],
  tokenKeyID: '1',
  messageBoxHost: 'https://messagebox.babbage.systems',
  registryUrl: undefined
}

export function mergeDefaults (partial: Partial<WalletDefaults>): WalletDefaults {
  return { ...DEFAULT_CONFIG, ...partial }
}
