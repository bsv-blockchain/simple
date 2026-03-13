import {
  SimpleError,
  WalletError,
  TransactionError,
  MessageBoxError,
  CertificationError,
  DIDError,
  CredentialError,
  TokenError
} from '../errors'

describe('Error classes', () => {
  it('SimpleError should have correct name and optional code', () => {
    const err = new SimpleError('test message', 'TEST_CODE')
    expect(err.message).toBe('test message')
    expect(err.code).toBe('TEST_CODE')
    expect(err.name).toBe('SimpleError')
    expect(err).toBeInstanceOf(Error)
  })

  it('SimpleError works without code', () => {
    const err = new SimpleError('no code')
    expect(err.code).toBeUndefined()
  })

  it('TokenError should have correct name and TOKEN_ERROR code', () => {
    const err = new TokenError('token issue')
    expect(err.message).toBe('token issue')
    expect(err.code).toBe('TOKEN_ERROR')
    expect(err.name).toBe('TokenError')
    expect(err).toBeInstanceOf(SimpleError)
    expect(err).toBeInstanceOf(Error)
  })

  it.each([
    ['WalletError', WalletError, 'WALLET_ERROR'],
    ['TransactionError', TransactionError, 'TRANSACTION_ERROR'],
    ['MessageBoxError', MessageBoxError, 'MESSAGEBOX_ERROR'],
    ['CertificationError', CertificationError, 'CERTIFICATION_ERROR'],
    ['DIDError', DIDError, 'DID_ERROR'],
    ['CredentialError', CredentialError, 'CREDENTIAL_ERROR'],
    ['TokenError', TokenError, 'TOKEN_ERROR']
  ] as const)('%s should have code %s', (name, ErrorClass, expectedCode) => {
    const err = new ErrorClass('test')
    expect(err.name).toBe(name)
    expect(err.code).toBe(expectedCode)
    expect(err).toBeInstanceOf(SimpleError)
  })
})
