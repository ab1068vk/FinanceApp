import { Platform } from 'react-native';
import api from './api';

type ExpoNotificationsModule = {
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: () => Promise<{ data: string }>;
};

function getNotificationsModule(): ExpoNotificationsModule | null {
  try {
    // Optional at runtime so local typecheck keeps working before native deps are installed.
    return require('expo-notifications') as ExpoNotificationsModule;
  } catch {
    return null;
  }
}

export async function registerPushNotificationsAfterLogin() {
  const Notifications = getNotificationsModule();
  if (!Notifications || Platform.OS === 'web') return null;

  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === 'granted'
    ? current
    : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return null;

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  await api.post('/api/auth/push-token', { token, platform: Platform.OS });
  return token;
}
