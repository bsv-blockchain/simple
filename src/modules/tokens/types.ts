import { TransactionResult } from '../../core/types'
import type { MAP } from './templates/ord-p2pkh'

// ============================================================================
// Token Standard Discriminant
// ============================================================================

export type TokenStandard = 'pushdrop' | 'ordinal' | 'bsv-21' | 'bsv-20'

// ============================================================================
// Unified Mint Options (discriminated union on `standard`)
// ============================================================================

export interface MintTokenBaseOptions {
  basket?: string
  description?: string
}

export interface MintPushDropOptions extends MintTokenBaseOptions {
  standard?: 'pushdrop'
  to?: string
  data: any
  protocolID?: [number, string]
  keyID?: string
  satoshis?: number
}

export interface MintOrdinalOptions extends MintTokenBaseOptions {
  standard: 'ordinal'
  content: string | Uint8Array
  contentType: string
  to?: string
  metadata?: MAP
}

export interface MintBsv21Options extends MintTokenBaseOptions {
  standard: 'bsv-21'
  op: 'deploy+mint' | 'transfer'
  symbol?: string
  amount: number
  decimals?: number
  icon?: string
  to?: string
  tokenId?: string
  recipients?: Array<{ to: string; amount: number }>
}

export interface MintBsv20Options extends MintTokenBaseOptions {
  standard: 'bsv-20'
  op: 'deploy' | 'mint' | 'transfer'
  ticker: string
  amount?: number
  maxSupply?: number
  mintLimit?: number
  decimals?: number
  to?: string
  tokenId?: string
  recipients?: Array<{ to: string; amount: number }>
}

export type MintTokenOptions =
  | MintPushDropOptions
  | MintOrdinalOptions
  | MintBsv21Options
  | MintBsv20Options

// ============================================================================
// Unified Token Detail (returned by listTokens)
// ============================================================================

export interface TokenInfo {
  outpoint: string
  satoshis: number
  standard: TokenStandard
  lockingScript: string
}

export interface PushDropTokenInfo extends TokenInfo {
  standard: 'pushdrop'
  data: any
  protocolID: any
  keyID: string
  counterparty: string
}

export interface OrdinalTokenInfo extends TokenInfo {
  standard: 'ordinal'
  contentType: string
  dataB64: string
  metadata?: MAP
}

export interface Bsv21TokenInfo extends TokenInfo {
  standard: 'bsv-21'
  op: string
  tokenId: string
  amount: number
  symbol?: string
  decimals?: number
}

export interface Bsv20TokenInfo extends TokenInfo {
  standard: 'bsv-20'
  op: string
  ticker: string
  amount: number
  decimals?: number
}

export type UnifiedTokenInfo =
  | PushDropTokenInfo
  | OrdinalTokenInfo
  | Bsv21TokenInfo
  | Bsv20TokenInfo

// ============================================================================
// Transfer Options
// ============================================================================

export interface TransferTokenOptions {
  basket: string
  outpoint: string
  to: string
  standard?: TokenStandard
}

// ============================================================================
// Burn Options
// ============================================================================

export interface BurnTokenOptions {
  basket: string
  outpoint: string
  standard?: TokenStandard
}

// ============================================================================
// List Options
// ============================================================================

export interface ListTokensOptions {
  basket?: string
  standard?: TokenStandard
}

// ============================================================================
// Standard-Specific Convenience Options
// ============================================================================

export interface InscribeOrdinalOptions {
  content: string | Uint8Array
  contentType: string
  to?: string
  metadata?: MAP
  basket?: string
  description?: string
}

export interface DeployBsv21Options {
  op: 'deploy+mint'
  amount: number
  symbol?: string
  decimals?: number
  icon?: string
  to?: string
  basket?: string
  description?: string
}

export interface TransferBsv21Options {
  op: 'transfer'
  tokenId: string
  recipients: Array<{ to: string; amount: number }>
  basket?: string
  description?: string
}

export interface DeployBsv20Options {
  op: 'deploy'
  ticker: string
  maxSupply: number
  mintLimit?: number
  decimals?: number
  basket?: string
  description?: string
}

export interface MintBsv20TickerOptions {
  op: 'mint'
  ticker: string
  amount: number
  to?: string
  basket?: string
  description?: string
}

export interface TransferBsv20Options {
  op: 'transfer'
  ticker: string
  tokenId: string
  recipients: Array<{ to: string; amount: number }>
  basket?: string
  description?: string
}

// ============================================================================
// Mint Results
// ============================================================================

export interface MintTokenResult extends TransactionResult {
  standard: TokenStandard
  basket: string
  tokenId?: string
}

// ============================================================================
// Marketplace Types
// ============================================================================

export interface ListForSaleOptions {
  basket: string
  outpoint: string
  price: number
  assetId?: string
  metadata?: Record<string, any>
  description?: string
}

export interface PurchaseOrdinalOptions {
  listingOutpoint: string
  basket?: string
  description?: string
}

export interface CancelListingOptions {
  listingOutpoint: string
  basket?: string
  description?: string
}

// ============================================================================
// Optional Token Indexer Interface
// ============================================================================

export interface TokenIndexer {
  getTokenInfo (tokenId: string): Promise<{ symbol?: string; decimals: number; totalSupply: number }>
  getBalance (tokenId: string, ownerKey: string): Promise<number>
  getUtxos (tokenId: string, ownerKey: string): Promise<Array<{ outpoint: string; amount: number }>>
}
