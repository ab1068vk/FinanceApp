import axios from 'axios';
import { API_BASE_URL } from '../constants';

type ClientErrorPayload = {
  message: string;
  stack?: string;
  screen?: string;
  appVersion?: string;
  platform?: string;
  type?: 'client' | 'security';
  metadata?: Record<string, unknown>;
};

export async function reportClientError(payload: ClientErrorPayload): Promise<void> {
  try {
    await axios.post(`${API_BASE_URL}/api/client-error`, payload, { timeout: 5000 });
  } catch {
    // Error reporting must never create another user-visible failure.
  }
}
