import * as SecureStore from 'expo-secure-store';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from '../constants';

export type StoredUser = {
  id: string;
  email: string;
  full_name: string;
  avatar_color?: string;
  role: 'user' | 'admin';
  is_active?: boolean;
  must_change_password?: boolean;
  [key: string]: unknown;
};

const TOKEN_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Unlock FinanceApp',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'financeapp.authTokens.biometric',
};

const LEGACY_TOKEN_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function deleteToken(key: string) {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(key, TOKEN_STORE_OPTIONS),
    SecureStore.deleteItemAsync(key, LEGACY_TOKEN_STORE_OPTIONS),
    SecureStore.deleteItemAsync(key),
  ]);
}

function tokenStoreOptions() {
  return SecureStore.canUseBiometricAuthentication() ? TOKEN_STORE_OPTIONS : LEGACY_TOKEN_STORE_OPTIONS;
}

async function saveToken(key: string, value: string) {
  await deleteToken(key);
  await SecureStore.setItemAsync(key, value, tokenStoreOptions());
}

async function getToken(key: string) {
  if (SecureStore.canUseBiometricAuthentication()) {
    try {
      const protectedToken = await SecureStore.getItemAsync(key, TOKEN_STORE_OPTIONS);
      if (protectedToken) return protectedToken;
    } catch {
      return null;
    }
  }

  const legacyToken = await SecureStore.getItemAsync(key);
  if (!legacyToken) return null;

  await saveToken(key, legacyToken);
  return legacyToken;
}

export async function saveTokens(accessToken: string, refreshToken: string) {
  await saveToken(ACCESS_TOKEN_KEY, accessToken);
  await saveToken(REFRESH_TOKEN_KEY, refreshToken);
}

export async function getTokens() {
  const accessToken = await getToken(ACCESS_TOKEN_KEY);
  const refreshToken = await getToken(REFRESH_TOKEN_KEY);

  return { accessToken, refreshToken };
}

export async function protectStoredTokens() {
  if (!SecureStore.canUseBiometricAuthentication()) return;

  const [legacyAccessToken, legacyRefreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);

  if (legacyAccessToken && legacyRefreshToken) {
    await saveTokens(legacyAccessToken, legacyRefreshToken);
  }
}

export async function clearTokens() {
  await deleteToken(ACCESS_TOKEN_KEY);
  await deleteToken(REFRESH_TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

export async function saveUser(user: StoredUser) {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export async function getUser(): Promise<StoredUser | null> {
  const rawUser = await SecureStore.getItemAsync(USER_KEY);
  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser) as StoredUser;
  } catch {
    await SecureStore.deleteItemAsync(USER_KEY);
    return null;
  }
}
