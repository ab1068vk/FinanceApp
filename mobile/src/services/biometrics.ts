import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { BIOMETRIC_UNLOCK_KEY } from '../constants';
import { protectStoredTokens } from './secureStorage';

export async function canUseBiometricAuth(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

export async function getBiometricPreference(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY)) === 'true';
}

export async function setBiometricPreference(enabled: boolean): Promise<void> {
  if (enabled && !(await canUseBiometricAuth())) {
    throw new Error('Biometric unlock is not available on this device.');
  }
  await SecureStore.setItemAsync(BIOMETRIC_UNLOCK_KEY, enabled ? 'true' : 'false');
  if (enabled) await protectStoredTokens();
}

export async function authenticateWithBiometrics(promptMessage = 'Unlock FinanceApp'): Promise<boolean> {
  if (!(await getBiometricPreference())) return true;
  if (!(await canUseBiometricAuth())) return false;

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Use password',
    disableDeviceFallback: false,
  });
  return result.success;
}
