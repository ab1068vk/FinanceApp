import { API_BASE_URL } from '../constants';

type CertificatePinningModule = {
  initializeSslPinning?: (config: Record<string, { publicKeyHashes: string[] }>) => void;
};

type ConfigureTlsPinningOptions = {
  apiBaseUrl?: string;
  certHash?: string;
  nodeEnv?: string;
  loadModule?: () => CertificatePinningModule;
};

export const TLS_PINNING_REQUIRED_ERROR = 'TLS certificate pinning is required in production builds';

function isProduction(nodeEnv?: string) {
  return nodeEnv === 'production';
}

function missingPinningError(reason: string) {
  return new Error(`${TLS_PINNING_REQUIRED_ERROR}: ${reason}`);
}

export function configureTlsPinning({
  apiBaseUrl = API_BASE_URL,
  certHash = process.env.EXPO_PUBLIC_API_CERT_HASH,
  nodeEnv = process.env.NODE_ENV,
  loadModule = () => require('expo-certificate-pinning') as CertificatePinningModule,
}: ConfigureTlsPinningOptions = {}) {
  let failureReason = '';

  if (!certHash?.trim()) {
    failureReason = 'EXPO_PUBLIC_API_CERT_HASH is not set';
  } else {
    try {
      const certificatePinning = loadModule();
      if (!certificatePinning?.initializeSslPinning) {
        failureReason = 'certificate pinning module does not expose initializeSslPinning';
      } else {
        certificatePinning.initializeSslPinning({ [apiBaseUrl]: { publicKeyHashes: [certHash] } });
        return true;
      }
    } catch (error) {
      failureReason = error instanceof Error ? error.message : 'certificate pinning initialization failed';
    }
  }

  if (isProduction(nodeEnv)) {
    throw missingPinningError(failureReason);
  }

  if (failureReason) {
    console.warn(`SSL certificate pinning is not active: ${failureReason}`);
  }
  return false;
}
