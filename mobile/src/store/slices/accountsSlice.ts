import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import api from '../../services/api';
import { showToast } from '../../components/common/Toast';
import { ListPayload, unwrapList } from '../../types/api';
import { enqueue } from '../../utils/offlineQueue';

export type AccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'cash';

export type Account = {
  id: string;
  user_id?: string;
  name: string;
  type: AccountType;
  balance: number;
  current_balance?: number;
  overdraft_limit?: number;
  currency: string;
  color?: string;
  icon?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string | null;
};

export type CreateAccountData = {
  name: string;
  type: AccountType;
  currency: string;
  color: string;
  icon: string;
  balance?: number;
  overdraft_limit?: number;
};

export type UpdateAccountData = Partial<Pick<CreateAccountData, 'name' | 'currency' | 'color' | 'icon' | 'overdraft_limit'>>;
export type DeleteAccountAction = 'delete' | 'cash';

type AccountsState = {
  accounts: Account[];
  selectedAccount: Account | null;
  isLoading: boolean;
  error: string | null;
};

const initialState: AccountsState = {
  accounts: [],
  selectedAccount: null,
  isLoading: false,
  error: null,
};

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    return response?.data?.error || fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

function isNetworkError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    return !(error as { response?: unknown }).response;
  }
  return error instanceof Error;
}

function tempId() {
  return `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const fetchAccounts = createAsyncThunk<Account[], void, { rejectValue: string }>(
  'accounts/fetchAccounts',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.get<ListPayload<Account>>('/api/accounts', { params: { page: 1, limit: 200 } });
      return unwrapList(response.data);
    } catch (error) {
      return rejectWithValue(errorMessage(error, 'Unable to load accounts'));
    }
  }
);

export const createAccount = createAsyncThunk<Account, CreateAccountData, { rejectValue: string }>(
  'accounts/createAccount',
  async (data, { rejectWithValue }) => {
    try {
      const response = await api.post<Account>('/api/accounts', data);
      return response.data;
    } catch (error) {
      if (isNetworkError(error)) {
        await enqueue({ method: 'POST', url: '/api/accounts', data, description: `Create account ${data.name}` });
        showToast({ type: 'info', text1: 'Saved offline', text2: 'Will sync when reconnected' });
        return {
          ...data,
          id: tempId(),
          balance: data.balance || 0,
          current_balance: data.balance || 0,
          is_active: true,
          created_at: new Date().toISOString(),
        };
      }
      return rejectWithValue(errorMessage(error, 'Unable to create account'));
    }
  }
);

export const updateAccount = createAsyncThunk<Account, { id: string; data: UpdateAccountData }, { rejectValue: string }>(
  'accounts/updateAccount',
  async ({ id, data }, { rejectWithValue }) => {
    try {
      const response = await api.put<Account>(`/api/accounts/${id}`, data);
      return response.data;
    } catch (error) {
      if (isNetworkError(error)) {
        await enqueue({ method: 'PUT', url: `/api/accounts/${id}`, data, description: 'Update account' });
        showToast({ type: 'info', text1: 'Saved offline', text2: 'Will sync when reconnected' });
        return { id, ...(data as Partial<Account>) } as Account;
      }
      return rejectWithValue(errorMessage(error, 'Unable to update account'));
    }
  }
);

export const deleteAccount = createAsyncThunk<string, { id: string; transactionAction: DeleteAccountAction }, { rejectValue: string }>(
  'accounts/deleteAccount',
  async ({ id, transactionAction }, { rejectWithValue }) => {
    try {
      await api.delete(`/api/accounts/${id}`, { params: { transaction_action: transactionAction } });
      return id;
    } catch (error) {
      if (isNetworkError(error)) {
        await enqueue({ method: 'DELETE', url: `/api/accounts/${id}?transaction_action=${encodeURIComponent(transactionAction)}`, description: 'Delete account' });
        showToast({ type: 'info', text1: 'Saved offline', text2: 'Will sync when reconnected' });
        return id;
      }
      return rejectWithValue(errorMessage(error, 'Unable to delete account'));
    }
  }
);

const accountsSlice = createSlice({
  name: 'accounts',
  initialState,
  reducers: {
    setAccounts(state, action: PayloadAction<Account[]>) {
      state.accounts = action.payload;
      state.isLoading = false;
      state.error = null;
    },
    setSelectedAccount(state, action: PayloadAction<Account | null>) {
      state.selectedAccount = action.payload;
    },
    setAccountsLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload;
    },
    setAccountsError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
      state.isLoading = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAccounts.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchAccounts.fulfilled, (state, action) => {
        state.accounts = action.payload;
        state.selectedAccount = state.selectedAccount
          ? action.payload.find((account) => account.id === state.selectedAccount?.id) || action.payload[0] || null
          : action.payload[0] || null;
        state.isLoading = false;
        state.error = null;
      })
      .addCase(fetchAccounts.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload || 'Unable to load accounts';
      })
      .addCase(createAccount.fulfilled, (state, action) => {
        state.accounts.unshift(action.payload);
        state.selectedAccount = action.payload;
      })
      .addCase(updateAccount.fulfilled, (state, action) => {
        state.accounts = state.accounts.map((account) => account.id === action.payload.id ? { ...account, ...action.payload } : account);
        if (state.selectedAccount?.id === action.payload.id) {
          state.selectedAccount = { ...state.selectedAccount, ...action.payload };
        }
      })
      .addCase(deleteAccount.fulfilled, (state, action) => {
        state.accounts = state.accounts.filter((account) => account.id !== action.payload);
        if (state.selectedAccount?.id === action.payload) {
          state.selectedAccount = state.accounts[0] || null;
        }
      });
  },
});

export const accountsActions = accountsSlice.actions;
export default accountsSlice.reducer;
