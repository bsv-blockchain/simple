import { Utils } from '@bsv/sdk'
import { WalletCore } from '../core/WalletCore'
import { DIDDocument, DIDVerificationMethod, DIDParseResult } from '../core/types'
import { DIDError } from '../core/errors'
import { Certifier } from './certification'

// ============================================================================
// DID Utility Class (standalone — no wallet dependency)
// ============================================================================

const DID_PREFIX = 'did:bsv:'
const DID_CONTEXT = 'https://www.w3.org/ns/did/v1'
const VERIFICATION_KEY_TYPE = 'EcdsaSecp256k1VerificationKey2019'

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DID {
  /**
   * Generate a W3C DID Document from an identity key (compressed public key hex).
   */
  static fromIdentityKey (identityKey: string): DIDDocument {
    if (identityKey === '' || !/^[0-9a-fA-F]{66}$/.test(identityKey)) {
      throw new DIDError('Invalid identity key: must be a 66-character hex compressed public key')
    }

    const did = `${DID_PREFIX}${identityKey}`
    const keyId = `${did}#key-1`

    const verificationMethod: DIDVerificationMethod = {
      id: keyId,
      type: VERIFICATION_KEY_TYPE,
      controller: did,
      publicKeyHex: identityKey
    }

    return {
      '@context': [DID_CONTEXT],
      id: did,
      controller: did,
      verificationMethod: [verificationMethod],
      authentication: [keyId],
      assertionMethod: [keyId]
    }
  }

  /**
   * Parse a did:bsv: string and extract the identity key.
   */
  static parse (didString: string): DIDParseResult {
    if (didString === '' || !didString.startsWith(DID_PREFIX)) {
      throw new DIDError(`Invalid DID: must start with "${DID_PREFIX}"`)
    }

    const identityKey = didString.slice(DID_PREFIX.length)
    if (!/^[0-9a-fA-F]{66}$/.test(identityKey)) {
      throw new DIDError('Invalid DID: identity key portion must be a 66-character hex compressed public key')
    }

    return {
      method: 'bsv',
      identityKey
    }
  }

  /**
   * Validate a did:bsv: string format.
   */
  static isValid (didString: string): boolean {
    try {
      DID.parse(didString)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the certificate type used for DID persistence.
   */
  static getCertificateType (): string {
    return Utils.toBase64(Utils.toArray('did:bsv', 'utf8'))
  }
}

// ============================================================================
// Wallet-integrated DID methods
// ============================================================================

export function createDIDMethods (core: WalletCore): {
  getDID: () => DIDDocument
  resolveDID: (didString: string) => DIDDocument
  registerDID: (options?: { persist?: boolean }) => Promise<DIDDocument>
} {
  return {
    /**
     * Get this wallet's DID Document.
     */
    getDID (): DIDDocument {
      return DID.fromIdentityKey(core.getIdentityKey())
    },

    /**
     * Resolve any did:bsv: string to its DID Document.
     */
    resolveDID (didString: string): DIDDocument {
      const parsed = DID.parse(didString)
      return DID.fromIdentityKey(parsed.identityKey)
    },

    /**
     * Optionally persist this wallet's DID as a BSV certificate.
     */
    async registerDID (options?: { persist?: boolean }): Promise<DIDDocument> {
      const identityKey = core.getIdentityKey()
      const didDoc = DID.fromIdentityKey(identityKey)

      if (options?.persist !== false) {
        try {
          const certifier = await Certifier.create({
            certificateType: DID.getCertificateType()
          })

          await certifier.certify(core, {
            didId: didDoc.id,
            didType: 'identity',
            version: '1.0',
            created: new Date().toISOString(),
            isDID: 'true'
          })
        } catch (error) {
          throw new DIDError(`DID registration failed: ${(error as Error).message}`)
        }
      }

      return didDoc
    }
  }
}
