import * as SecureStore from 'expo-secure-store';

export type AutoLockPreference = '1 min' | '5 min' | '15 min' | 'Never';

const AUTO_LOCK_KEY = 'financeapp.autoLockTimeout';
const AUTO_LOCK_MS: Record<AutoLockPreference, number | null> = {
  '1 min': 60 * 1000,
  '5 min': 5 * 60 * 1000,
  '15 min': 15 * 60 * 1000,
  Never: null,
};

export const DEFAULT_AUTO_LOCK: AutoLockPreference = '5 min';

export async function getAutoLockPreference(): Promise<AutoLockPreference> {
  const stored = await SecureStore.getItemAsync(AUTO_LOCK_KEY);
  return stored === '1 min' || stored === '5 min' || stored === '15 min' || stored === 'Never'
    ? stored
    : DEFAULT_AUTO_LOCK;
}

export async function setAutoLockPreference(preference: AutoLockPreference) {
  await SecureStore.setItemAsync(AUTO_LOCK_KEY, preference);
}

export function autoLockTimeoutMs(preference: AutoLockPreference) {
  return AUTO_LOCK_MS[preference];
}
