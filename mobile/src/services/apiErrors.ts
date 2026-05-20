import axios from 'axios';

export type ApiErrorDetail = {
  field: string;
  message: string;
};

export type ApiErrorEnvelope = {
  error?: string;
  details?: ApiErrorDetail[];
  retryAfter?: { minutes?: number };
};

export type CanonicalApiError = Error & {
  userMessage?: string;
};

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError<ApiErrorEnvelope>(error)) {
    return error.response?.data?.error || error.message || fallback;
  }

  if (typeof error === 'object' && error !== null && 'userMessage' in error) {
    return String((error as CanonicalApiError).userMessage || fallback);
  }

  if (error instanceof Error) return error.message;
  return fallback;
}

export function attachApiErrorMessage(error: unknown, fallback = 'Request failed') {
  if (typeof error === 'object' && error !== null) {
    (error as CanonicalApiError).userMessage = getApiErrorMessage(error, fallback);
  }
  return error;
}
