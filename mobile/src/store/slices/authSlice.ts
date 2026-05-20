import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import axios, { AxiosError } from 'axios';
import { API_BASE_URL } from '../../constants';
import type { ApiErrorEnvelope } from '../../services/apiErrors';
import { clearTokens, getTokens, getUser, saveTokens, saveUser } from '../../services/secureStorage';

export type User = {
  id: string;
  email: string;
  full_name: string;
  avatar_color?: string;
  role: 'user' | 'admin';
  is_active?: boolean;
  must_change_password?: boolean;
  [key: string]: unknown;
};

export type AuthState = {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
};

export type LoginCredentials = {
  email: string;
  password: string;
};

export type RegisterData = LoginCredentials & {
  full_name: string;
};

export type RegisterResponse = {
  success: boolean;
  message: string;
  verificationToken?: string;
};

type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  user: User;
};

type ApiErrorPayload = {
  message: string;
  status?: number;
  retryAfterMinutes?: number;
};

const initialState: AuthState = {
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
};

function normalizeAuthError(error: unknown): ApiErrorPayload {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorEnvelope>;
    const status = axiosError.response?.status;

    if (!axiosError.response) {
      return {
        message: `Cannot reach the FinanceApp backend at ${API_BASE_URL}. Start the backend or set EXPO_PUBLIC_API_BASE_URL to your computer's LAN URL.`,
      };
    }

    if (status === 423) {
      const retryAfterMinutes = axiosError.response?.data?.retryAfter?.minutes;
      return {
        message: `Account temporarily locked. Try again in ${retryAfterMinutes || 30} minutes.`,
        status,
        retryAfterMinutes,
      };
    }

    if (status === 403 && axiosError.response?.data?.error) {
      return {
        message: axiosError.response.data.error,
        status,
      };
    }

    return {
      message: axiosError.response?.data?.error || axiosError.message || 'Authentication failed',
      status,
    };
  }

  return { message: 'Authentication failed' };
}

export const loginUser = createAsyncThunk<LoginResponse, LoginCredentials, { rejectValue: ApiErrorPayload }>(
  'auth/loginUser',
  async (credentials, { rejectWithValue }) => {
    try {
      const response = await axios.post<LoginResponse>(`${API_BASE_URL}/api/auth/login`, credentials, { timeout: 10000 });
      await Promise.all([
        saveTokens(response.data.accessToken, response.data.refreshToken),
        saveUser(response.data.user),
      ]);
      return response.data;
    } catch (error) {
      return rejectWithValue(normalizeAuthError(error));
    }
  }
);

export const registerUser = createAsyncThunk<RegisterResponse, RegisterData, { rejectValue: ApiErrorPayload }>(
  'auth/registerUser',
  async (data, { rejectWithValue }) => {
    try {
      const response = await axios.post<RegisterResponse>(`${API_BASE_URL}/api/auth/register`, data, { timeout: 10000 });
      return response.data;
    } catch (error) {
      return rejectWithValue(normalizeAuthError(error));
    }
  }
);

export const logoutUser = createAsyncThunk('auth/logoutUser', async () => {
  const { accessToken, refreshToken } = await getTokens();

  if (accessToken && refreshToken) {
    try {
      await axios.post(
        `${API_BASE_URL}/api/auth/logout`,
        { refreshToken },
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
      );
    } catch {
      // Local logout should always complete even if the server is unreachable.
    }
  }

  await clearTokens();
});

export const refreshAccessToken = createAsyncThunk<string, void, { rejectValue: ApiErrorPayload }>(
  'auth/refreshAccessToken',
  async (_, { rejectWithValue }) => {
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
      await saveTokens(response.data.accessToken, response.data.refreshToken || refreshToken);
      return response.data.accessToken;
    } catch (error) {
      await clearTokens();
      return rejectWithValue(normalizeAuthError(error));
    }
  }
);

export const loadStoredAuth = createAsyncThunk<Pick<LoginResponse, 'accessToken' | 'user'> | null>(
  'auth/loadStoredAuth',
  async () => {
    const { accessToken, refreshToken } = await getTokens();
    if (!accessToken || !refreshToken) {
      await clearTokens();
      return null;
    }

    try {
      const me = await axios.get<User>(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });
      await saveUser(me.data);
      return { accessToken, user: me.data };
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 401) {
        const cachedUser = await getUser();
        if (cachedUser) return { accessToken, user: cachedUser };
        await clearTokens();
        return null;
      }

      try {
        const refreshed = await axios.post<{ accessToken: string; refreshToken?: string }>(
          `${API_BASE_URL}/api/auth/refresh`,
          { refreshToken },
          { timeout: 10000 }
        );
        const nextAccessToken = refreshed.data.accessToken;
        const nextRefreshToken = refreshed.data.refreshToken || refreshToken;
        const me = await axios.get<User>(`${API_BASE_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${nextAccessToken}` },
          timeout: 10000,
        });
        await Promise.all([
          saveTokens(nextAccessToken, nextRefreshToken),
          saveUser(me.data),
        ]);
        return { accessToken: nextAccessToken, user: me.data };
      } catch {
        await clearTokens();
        return null;
      }
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAccessToken(state, action: PayloadAction<string | null>) {
      state.accessToken = action.payload;
      state.isAuthenticated = Boolean(action.payload && state.user);
    },
    setUser(state, action: PayloadAction<User | null>) {
      state.user = action.payload;
      state.isAuthenticated = Boolean(action.payload && state.accessToken);
    },
    clearAuthError(state) {
      state.error = null;
    },
    logout(state) {
      state.user = null;
      state.accessToken = null;
      state.isAuthenticated = false;
      state.isLoading = false;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginUser.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.user = {
          ...action.payload.user,
          must_change_password: action.payload.user.must_change_password,
        };
        state.accessToken = action.payload.accessToken;
        state.isAuthenticated = true;
        state.isLoading = false;
        state.error = null;
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload?.message || 'Unable to sign in';
      })
      .addCase(registerUser.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(registerUser.fulfilled, (state, action) => {
        state.user = null;
        state.accessToken = null;
        state.isAuthenticated = false;
        state.isLoading = false;
        state.error = null;
      })
      .addCase(registerUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload?.message || 'Unable to create account';
      })
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null;
        state.accessToken = null;
        state.isAuthenticated = false;
        state.isLoading = false;
        state.error = null;
      })
      .addCase(refreshAccessToken.fulfilled, (state, action) => {
        state.accessToken = action.payload;
        state.isAuthenticated = Boolean(state.user);
      })
      .addCase(refreshAccessToken.rejected, (state, action) => {
        state.user = null;
        state.accessToken = null;
        state.isAuthenticated = false;
        state.isLoading = false;
        state.error = action.payload?.message || null;
      })
      .addCase(loadStoredAuth.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(loadStoredAuth.fulfilled, (state, action) => {
        state.user = action.payload?.user || null;
        state.accessToken = action.payload?.accessToken || null;
        state.isAuthenticated = Boolean(action.payload?.user && action.payload?.accessToken);
        state.isLoading = false;
        state.error = null;
      })
      .addCase(loadStoredAuth.rejected, (state) => {
        state.user = null;
        state.accessToken = null;
        state.isAuthenticated = false;
        state.isLoading = false;
      });
  },
});

export const authActions = authSlice.actions;
export default authSlice.reducer;
