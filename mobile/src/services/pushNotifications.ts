import { Platform } from 'react-native';
import Constants from 'expo-constants';
import api from './api';

type ExpoNotificationsModule = {
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: (options?: { projectId?: string }) => Promise<{ data: string }>;
};

function isAndroidExpoGo() {
  const constants = Constants as typeof Constants & {
    appOwnership?: string;
    executionEnvironment?: string;
  };

  return Platform.OS === 'android'
    && (constants.appOwnership === 'expo' || constants.executionEnvironment === 'storeClient');
}

function getExpoProjectId() {
  const constants = Constants as typeof Constants & {
    easConfig?: { projectId?: string };
    expoConfig?: { extra?: { eas?: { projectId?: string } } };
  };

  return constants.easConfig?.projectId || constants.expoConfig?.extra?.eas?.projectId;
}

function getNotificationsModule(): ExpoNotificationsModule | null {
  try {
    // Optional at runtime so local typecheck keeps working before native deps are installed.
    return require('expo-notifications') as ExpoNotificationsModule;
  } catch {
    return null;
  }
}

export async function registerPushNotificationsAfterLogin() {
  if (Platform.OS === 'web' || isAndroidExpoGo()) return null;

  const Notifications = getNotificationsModule();
  if (!Notifications) return null;

  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === 'granted'
    ? current
    : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return null;

  const projectId = getExpoProjectId();
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await api.post('/api/auth/push-token', { token, platform: Platform.OS });
  return token;
}
