import { Platform } from 'react-native';
import { reportClientError } from './clientErrors';

type DeviceModule = {
  isDevice?: boolean;
  deviceName?: string | null;
};

type JailMonkeyModule = {
  isJailBroken?: () => boolean;
  jailBrokenMessage?: () => string;
  hookDetected?: () => boolean;
  isOnExternalStorage?: () => boolean;
  AdbEnabled?: () => boolean;
  canMockLocation?: () => boolean;
  trustFall?: () => boolean;
  isDebuggedMode?: () => Promise<boolean>;
  isDevelopmentSettingsMode?: () => Promise<boolean>;
};

type DeviceSecurityFinding =
  | 'emulator'
  | 'root_or_jailbreak'
  | 'runtime_hook'
  | 'external_storage'
  | 'adb_enabled'
  | 'mock_location'
  | 'debugged_mode'
  | 'development_settings';

export type DeviceSecurityResult = {
  insecure: boolean;
  findings: DeviceSecurityFinding[];
  userMessage: string;
};

type DetectOptions = {
  device?: DeviceModule | null;
  jailMonkey?: JailMonkeyModule | null;
  platform?: string;
  report?: typeof reportClientError;
  screen?: string;
};

export const DEVICE_SECURITY_WARNING =
  'This device appears to be rooted, jailbroken, emulated, or otherwise insecure. For your security, some features may be restricted.';

function optionalDevice(): DeviceModule | null {
  try {
    return require('expo-device') as DeviceModule;
  } catch {
    return null;
  }
}

function optionalJailMonkey(): JailMonkeyModule | null {
  try {
    const module = require('jail-monkey') as unknown;
    if (module && typeof module === 'object' && 'default' in module) {
      const wrapped = module as { default?: JailMonkeyModule };
      if (wrapped.default) return wrapped.default;
    }
    return module as JailMonkeyModule;
  } catch {
    return null;
  }
}

function isEnabled(check: (() => boolean) | undefined): boolean {
  if (!check) return false;
  return check();
}

async function isAsyncEnabled(check: (() => Promise<boolean>) | undefined): Promise<boolean> {
  if (!check) return false;
  return check();
}

export async function detectDeviceSecurityRisk(options: DetectOptions = {}): Promise<DeviceSecurityResult> {
  const platform = options.platform ?? Platform.OS;
  const Device = options.device === undefined ? optionalDevice() : options.device;
  const JailMonkey = options.jailMonkey === undefined ? optionalJailMonkey() : options.jailMonkey;
  const report = options.report ?? reportClientError;
  const findings: DeviceSecurityFinding[] = [];

  if (platform !== 'web' && Device?.isDevice === false) {
    findings.push('emulator');
  }

  if (platform !== 'web' && JailMonkey) {
    if (isEnabled(JailMonkey.isJailBroken)) findings.push('root_or_jailbreak');
    if (isEnabled(JailMonkey.hookDetected)) findings.push('runtime_hook');
    if (isEnabled(JailMonkey.isOnExternalStorage)) findings.push('external_storage');
    if (isEnabled(JailMonkey.AdbEnabled)) findings.push('adb_enabled');
    if (isEnabled(JailMonkey.canMockLocation)) findings.push('mock_location');
    if (isEnabled(JailMonkey.trustFall) && !findings.includes('root_or_jailbreak')) {
      findings.push('root_or_jailbreak');
    }
    if (await isAsyncEnabled(JailMonkey.isDebuggedMode)) findings.push('debugged_mode');
    if (await isAsyncEnabled(JailMonkey.isDevelopmentSettingsMode)) findings.push('development_settings');
  }

  if (findings.length === 0) {
    return { insecure: false, findings, userMessage: '' };
  }

  await report({
    message: 'Potential insecure device detected',
    screen: options.screen ?? 'startup',
    platform,
    type: 'security',
    metadata: {
      findings,
      deviceName: Device?.deviceName || 'unknown',
      jailBrokenMessage: JailMonkey?.jailBrokenMessage?.() || undefined,
    },
  });

  return { insecure: true, findings, userMessage: DEVICE_SECURITY_WARNING };
}

export async function detectRootedOrJailbrokenDevice(): Promise<boolean> {
  const result = await detectDeviceSecurityRisk();
  return result.insecure;
}
