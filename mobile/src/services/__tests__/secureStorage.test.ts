import * as SecureStore from 'expo-secure-store';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from '../../constants';
import { getTokens, protectStoredTokens, saveTokens } from '../secureStorage';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  canUseBiometricAuthentication: jest.fn(),
}));

const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

const protectedTokenOptions = expect.objectContaining({
  requireAuthentication: true,
  authenticationPrompt: 'Unlock FinanceApp',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'financeapp.authTokens.biometric',
});

describe('secureStorage token protection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSecureStore.canUseBiometricAuthentication.mockReturnValue(true);
    mockedSecureStore.setItemAsync.mockResolvedValue(undefined);
    mockedSecureStore.getItemAsync.mockResolvedValue(null);
    mockedSecureStore.deleteItemAsync.mockResolvedValue(undefined);
  });

  it('stores access and refresh tokens with SecureStore authentication required', async () => {
    await saveTokens('access-token', 'refresh-token');

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      ACCESS_TOKEN_KEY,
      'access-token',
      protectedTokenOptions,
    );
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      REFRESH_TOKEN_KEY,
      'refresh-token',
      protectedTokenOptions,
    );
  });

  it('returns null tokens when the authenticated read is dismissed', async () => {
    mockedSecureStore.getItemAsync.mockRejectedValue(new Error('Authentication canceled'));

    await expect(getTokens()).resolves.toEqual({ accessToken: null, refreshToken: null });
  });

  it('migrates legacy tokens into authenticated storage when biometrics become available', async () => {
    mockedSecureStore.getItemAsync
      .mockResolvedValueOnce('legacy-access-token')
      .mockResolvedValueOnce('legacy-refresh-token');

    await protectStoredTokens();

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      ACCESS_TOKEN_KEY,
      'legacy-access-token',
      protectedTokenOptions,
    );
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      REFRESH_TOKEN_KEY,
      'legacy-refresh-token',
      protectedTokenOptions,
    );
  });
});
