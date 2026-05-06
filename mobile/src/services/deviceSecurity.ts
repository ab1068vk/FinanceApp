import { Platform } from 'react-native';
import { reportClientError } from './clientErrors';

type DeviceModule = {
  isDevice?: boolean;
  deviceName?: string | null;
};

function optionalDevice(): DeviceModule | null {
  try {
    return require('expo-device') as DeviceModule;
  } catch {
    return null;
  }
}

export async function detectRootedOrJailbrokenDevice() {
  const Device = optionalDevice();
  const suspicious = Platform.OS !== 'web' && Device?.isDevice === false;
  if (!suspicious) return false;

  await reportClientError({
    message: 'This device appears to be rooted or jailbroken. For your security, some features may be restricted.',
    screen: 'startup',
    platform: Platform.OS,
    type: 'security',
    metadata: { deviceName: Device?.deviceName || 'unknown' },
  });
  return true;
}
