import { WalletCore } from '../../core/WalletCore'
import { TransactionResult } from '../../core/types'
import { TokenStandard, UnifiedTokenInfo } from './types'

/**
 * Internal adapter interface for per-standard token operations.
 * Each token standard implements this interface to provide
 * create, list, send, and redeem functionality.
 */
export interface TokenAdapter {
  readonly standard: TokenStandard

  create (core: WalletCore, options: any): Promise<any>

  list (core: WalletCore, basket: string): Promise<UnifiedTokenInfo[]>

  send (core: WalletCore, options: any): Promise<TransactionResult>

  redeem (core: WalletCore, options: any): Promise<TransactionResult>

  detectFromScript? (lockingScriptHex: string): boolean
}
