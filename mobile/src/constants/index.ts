import { NativeModules, Platform } from 'react-native';

export function getDefaultApiBaseUrl() {
  const scriptURL = NativeModules.SourceCode?.scriptURL;
  const match = typeof scriptURL === 'string' ? scriptURL.match(/^[^:]+:\/\/([^/:]+)/) : null;
  const devHost = match?.[1];

  if (devHost && devHost !== 'localhost' && devHost !== '127.0.0.1') {
    return `http://${devHost}:3000`;
  }

  if (Platform.OS === 'android') return 'http://10.0.2.2:3000';
  return 'http://localhost:3000';
}

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || getDefaultApiBaseUrl();
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || '';
export const ACCESS_TOKEN_KEY = 'financeapp.accessToken';
export const REFRESH_TOKEN_KEY = 'financeapp.refreshToken';
export const USER_KEY = 'financeapp.user';
export const BIOMETRIC_UNLOCK_KEY = 'financeapp.biometricUnlock';
