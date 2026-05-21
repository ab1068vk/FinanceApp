import { configureTlsPinning, TLS_PINNING_REQUIRED_ERROR } from '../tlsPinning';

describe('configureTlsPinning', () => {
  const originalWarn = console.warn;

  beforeEach(() => {
    console.warn = jest.fn();
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it('throws in production when the cert hash is missing', () => {
    expect(() => configureTlsPinning({ certHash: '', nodeEnv: 'production' })).toThrow(TLS_PINNING_REQUIRED_ERROR);
  });

  it('throws in production when the pinning module cannot initialize', () => {
    expect(() => configureTlsPinning({
      certHash: 'sha256/example',
      nodeEnv: 'production',
      loadModule: () => {
        throw new Error('module missing');
      },
    })).toThrow(/module missing/);
  });

  it('configures the pinning module when a hash is present', () => {
    const initializeSslPinning = jest.fn();

    const configured = configureTlsPinning({
      apiBaseUrl: 'https://api.financeapp.test',
      certHash: 'sha256/example',
      nodeEnv: 'production',
      loadModule: () => ({ initializeSslPinning }),
    });

    expect(configured).toBe(true);
    expect(initializeSslPinning).toHaveBeenCalledWith({
      'https://api.financeapp.test': { publicKeyHashes: ['sha256/example'] },
    });
  });

  it('allows development builds to continue without pinning', () => {
    const configured = configureTlsPinning({ certHash: '', nodeEnv: 'development' });

    expect(configured).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('SSL certificate pinning is not active'));
  });
});
