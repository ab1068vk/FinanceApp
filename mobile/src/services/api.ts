import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../constants';
import { authActions, store } from '../store';
import { clearTokens, getTokens, saveTokens } from './secureStorage';

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
  _retryCount?: number;
};

type FailedQueueItem = {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

let isRefreshing = false;
let failedQueue: FailedQueueItem[] = [];
const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const RETRY_DELAYS_MS = [1000, 2000, 4000];
let pinningConfigured = false;

const processQueue = (error: unknown, token: string | null) => {
  const queue = failedQueue;
  failedQueue = [];

  queue.forEach(({ resolve, reject }) => {
    try {
      if (error || !token) {
        reject(error || new Error('Missing access token'));
      } else {
        resolve(token);
      }
    } catch {
      try {
        reject(error || new Error('Unable to settle queued request'));
      } catch {
        // Ignore a broken queue callback so the remaining requests can settle.
      }
    }
  });
};

const clearAuthAndLogout = async () => {
  await clearTokens();
  store.dispatch(authActions.logout());
};

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

try {
  const certHash = process.env.EXPO_PUBLIC_API_CERT_HASH;
  const CertificatePinning = require('expo-certificate-pinning');
  if (certHash && CertificatePinning?.initializeSslPinning) {
    CertificatePinning.initializeSslPinning({ [API_BASE_URL]: { publicKeyHashes: [certHash] } });
    pinningConfigured = true;
  }
} catch {
  if (process.env.NODE_ENV === 'production') {
    console.warn('SSL certificate pinning is not active. Install/configure expo-certificate-pinning for production builds.');
  }
}

api.interceptors.request.use(async (config) => {
  const method = String(config.method || 'get').toLowerCase();
  if (!pinningConfigured && process.env.NODE_ENV !== 'production') {
    config.headers['X-Cert-Pinning-Mode'] = 'development-fallback';
  }
  if (MUTATING_METHODS.has(method) && store.getState().ui.isOnline === false) {
    return Promise.reject(new Error('No internet connection. Changes are disabled while offline.'));
  }

  const { accessToken } = await getTokens();

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined;

    const status = error.response?.status;
    const shouldRetry = originalRequest
      && !originalRequest._retry
      && error.code !== 'ERR_CANCELED'
      && (status === undefined || status >= 500)
      && (originalRequest._retryCount || 0) < RETRY_DELAYS_MS.length;

    if (shouldRetry) {
      originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;
      const delay = RETRY_DELAYS_MS[originalRequest._retryCount - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      await new Promise((resolve) => setTimeout(resolve, delay));
      return api(originalRequest);
    }

    if (error.response?.status !== 401 || !originalRequest || originalRequest._retry) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      });
    }

    isRefreshing = true;

    try {
      const { refreshToken } = await getTokens();

      if (!refreshToken) {
        throw new Error('Missing refresh token');
      }

      const response = await axios.post<{ accessToken: string; refreshToken?: string }>(
        `${API_BASE_URL}/api/auth/refresh`,
        { refreshToken },
        { timeout: 10000 }
      );

      const newAccessToken = response.data.accessToken;
      const nextRefreshToken = response.data.refreshToken || refreshToken;
      await saveTokens(newAccessToken, nextRefreshToken);
      store.dispatch(authActions.setAccessToken(newAccessToken));
      processQueue(null, newAccessToken);
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;

      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      await clearAuthAndLogout();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default api;
