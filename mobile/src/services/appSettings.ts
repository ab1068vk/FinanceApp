import AsyncStorage from '@react-native-async-storage/async-storage';

export type Currency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD';
export type ThemeMode = 'Light' | 'Dark' | 'System';
export type AutoLock = 'Never' | '1 min' | '5 min' | '15 min';

export type AppSettings = {
  budgetAlerts: boolean;
  transactionConfirmations: boolean;
  currency: Currency;
  themeMode: ThemeMode;
  dateFormat: string;
  autoLock: AutoLock;
};

const SETTINGS_KEY = 'financeapp.settings';

export const defaultSettings: AppSettings = {
  budgetAlerts: true,
  transactionConfirmations: true,
  currency: 'USD',
  themeMode: 'System',
  dateFormat: 'MMM d, yyyy',
  autoLock: '5 min',
};

export async function loadAppSettings(): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) return defaultSettings;

  try {
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    await AsyncStorage.removeItem(SETTINGS_KEY);
    return defaultSettings;
  }
}

export async function saveAppSettings(settings: AppSettings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function updateAppSettings(updates: Partial<AppSettings>) {
  const next = { ...(await loadAppSettings()), ...updates };
  await saveAppSettings(next);
  return next;
}
