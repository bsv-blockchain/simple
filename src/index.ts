// Browser-compatible exports
export { createWallet, Wallet, Overlay, Certifier, WalletCore } from './browser'
export type { BrowserWallet } from './browser'

// DID & Credentials
export { DID } from './modules/did'
export {
  CredentialSchema,
  CredentialIssuer,
  MemoryRevocationStore,
  toVerifiableCredential,
  toVerifiablePresentation
} from './modules/credentials'

// Types (browser-safe only)
export type {
  Network,
  WalletDefaults,
  TransactionResult,
  OutputInfo,
  ReinternalizeResult,
  WalletStatus,
  WalletInfo,
  PaymentOptions,
  SendOutputSpec,
  SendOutputDetail,
  SendOptions,
  SendResult,
  DerivationInfo,
  PaymentDerivation,
  TokenOptions,
  TokenResult,
  TokenDetail,
  SendTokenOptions,
  RedeemTokenOptions,
  InscriptionType,
  InscriptionOptions,
  InscriptionResult,
  MessageBoxConfig,
  CertifierConfig,
  CertificateData,
  OverlayConfig,
  OverlayInfo,
  OverlayBroadcastResult,
  OverlayOutput,
  DIDDocument,
  DIDVerificationMethod,
  DIDParseResult,
  CredentialFieldType,
  CredentialFieldSchema,
  CredentialSchemaConfig,
  VerifiableCredential,
  VerifiablePresentation,
  VerificationResult,
  CredentialIssuerConfig,
  RevocationRecord,
  RevocationStore
} from './core/types'

// Errors
export {
  SimpleError,
  WalletError,
  TransactionError,
  MessageBoxError,
  CertificationError,
  DIDError,
  CredentialError
} from './core/errors'
