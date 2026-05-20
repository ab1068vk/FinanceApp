import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import api from '../../services/api';
import { getApiErrorMessage } from '../../services/apiErrors';
import { showToast } from '../../components/common/Toast';
import { enqueue } from '../../utils/offlineQueue';

export type TransactionType = 'income' | 'expense' | 'transfer';

export type Transaction = {
  id: string;
  user_id?: string;
  account_id?: string | null;
  to_account_id?: string;
  category_id: string;
  type: TransactionType;
  amount: number;
  description?: string | null;
  note?: string | null;
  date: string;
  recurring?: boolean;
  recurring_interval?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  receipt_path?: string | null;
  tags?: string | string[] | null;
  created_at?: string;
  updated_at?: string | null;
  category_name?: string;
  account_name?: string;
  [key: string]: unknown;
};

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type TransactionFilters = {
  account_id?: string;
  category_id?: string;
  type?: TransactionType;
  start_date?: string;
  end_date?: string;
  search?: string;
  page?: number;
  limit?: number;
  min_amount?: string;
  max_amount?: string;
};

export type TransactionSummary = {
  total_income: number;
  total_expense: number;
  net: number;
  grouped_by_category?: Array<Record<string, unknown>>;
};

export type CreateTransactionData = {
  account_id?: string;
  to_account_id?: string;
  category_id?: string;
  type: TransactionType;
  amount: number;
  description?: string;
  note?: string;
  date: string;
  tags?: string[];
  recurring?: boolean;
  recurring_interval?: 'daily' | 'weekly' | 'monthly' | 'yearly';
};

export type UpdateTransactionData = Partial<Pick<CreateTransactionData, 'amount' | 'description' | 'note' | 'category_id' | 'date' | 'tags' | 'recurring_interval'>> & {
  receipt_path?: string;
};

type TransactionsResponse = {
  data: Transaction[];
  pagination: Pagination;
};

type TransactionsState = {
  transactions: Transaction[];
  selectedTransaction: Transaction | null;
  pagination: Pagination;
  filters: TransactionFilters;
  summary: TransactionSummary;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
};

const initialPagination: Pagination = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
};

const initialSummary: TransactionSummary = {
  total_income: 0,
  total_expense: 0,
  net: 0,
  grouped_by_category: [],
};

const initialState: TransactionsState = {
  transactions: [],
  selectedTransaction: null,
  pagination: initialPagination,
  filters: { page: 1, limit: 20 },
  summary: initialSummary,
  isLoading: false,
  isLoadingMore: false,
  error: null,
};

function errorMessage(error: unknown, fallback: string) {
  return getApiErrorMessage(error, fallback);
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

function cleanFilters(filters: TransactionFilters) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

export const fetchTransactions = createAsyncThunk<TransactionsResponse, TransactionFilters | undefined, { rejectValue: string }>(
  'transactions/fetchTransactions',
  async (filters = {}, { rejectWithValue }) => {
    try {
      const params = cleanFilters({ limit: 20, page: 1, ...filters });
      const response = await api.get<TransactionsResponse>('/api/transactions', { params });
      return response.data;
    } catch (error) {
      return rejectWithValue(errorMessage(error, 'Unable to load transactions'));
    }
  }
);

export const fetchMoreTransactions = createAsyncThunk<TransactionsResponse | null, void, { rejectValue: string; state: { transactions: TransactionsState } }>(
  'transactions/fetchMoreTransactions',
  async (_, { getState, rejectWithValue }) => {
    const { filters, pagination } = getState().transactions;
    if (pagination.page >= pagination.totalPages) return null;

    try {
      const response = await api.get<TransactionsResponse>('/api/transactions', {
        params: cleanFilters({ ...filters, page: pagination.page + 1, limit: pagination.limit }),
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(errorMessage(error, 'Unable to load more transactions'));
    }
  }
);

export const createTransaction = createAsyncThunk<Transaction | Transaction[], CreateTransactionData, { rejectValue: string }>(
  'transactions/createTransaction',
  async (data, { rejectWithValue }) => {
    try {
      const response = await api.post<{ transactions: Transaction[] }>('/api/transactions', data);
      return response.data.transactions;
    } catch (error) {
      if (isNetworkError(error)) {
        await enqueue({ method: 'POST', url: '/api/transactions', data, description: 'Create transaction' });
        showToast({ type: 'info', text1: 'Saved offline', text2: 'Will sync when reconnected' });
        return {
          ...data,
          id: tempId(),
          category_id: data.category_id || '',
          date: data.date,
          recurring: Boolean(data.recurring),
          created_at: new Date().toISOString(),
        };
      }
      return rejectWithValue(errorMessage(error, 'Unable to save transaction'));
    }
  }
);

export const updateTransaction = createAsyncThunk<Transaction, { id: string; data: UpdateTransactionData }, { rejectValue: string }>(
  'transactions/updateTransaction',
  async ({ id, data }, { rejectWithValue }) => {
    try {
      const response = await api.put<Transaction>(`/api/transactions/${id}`, data);
      return response.data;
    } catch (error) {
      if (isNetworkError(error)) {
        await enqueue({ method: 'PUT', url: `/api/transactions/${id}`, data, description: 'Update transaction' });
        showToast({ type: 'info', text1: 'Saved offline', text2: 'Will sync when reconnected' });
        return { id, ...(data as Partial<Transaction>) } as Transaction;
      }
      return rejectWithValue(errorMessage(error, 'Unable to update transaction'));
    }
  }
);

export const deleteTransaction = createAsyncThunk<string, string, { rejectValue: string }>(
  'transactions/deleteTransaction',
  async (id, { rejectWithValue }) => {
    try {
      await api.delete(`/api/transactions/${id}`, { data: { confirm: true } });
      return id;
    } catch (error) {
      if (isNetworkError(error)) {
        await enqueue({ method: 'DELETE', url: `/api/transactions/${id}`, data: { confirm: true }, description: 'Delete transaction' });
        showToast({ type: 'info', text1: 'Saved offline', text2: 'Will sync when reconnected' });
        return id;
      }
      return rejectWithValue(errorMessage(error, 'Unable to delete transaction'));
    }
  }
);

export const bulkDeleteTransactions = createAsyncThunk<string[], string[], { rejectValue: string }>(
  'transactions/bulkDeleteTransactions',
  async (ids, { rejectWithValue }) => {
    try {
      await api.delete('/api/transactions/bulk', { data: { transaction_ids: ids, confirm: true } });
      return ids;
    } catch (error) {
      if (isNetworkError(error)) {
        await enqueue({ method: 'DELETE', url: '/api/transactions/bulk', data: { transaction_ids: ids, confirm: true }, description: 'Delete selected transactions' });
        showToast({ type: 'info', text1: 'Saved offline', text2: 'Will sync when reconnected' });
        return ids;
      }
      return rejectWithValue(errorMessage(error, 'Unable to delete selected transactions'));
    }
  }
);

export const bulkUpdateTransactionCategory = createAsyncThunk<{ ids: string[]; categoryId: string }, { ids: string[]; categoryId: string }, { rejectValue: string }>(
  'transactions/bulkUpdateTransactionCategory',
  async ({ ids, categoryId }, { rejectWithValue }) => {
    try {
      await api.patch('/api/transactions/bulk/category', { transaction_ids: ids, category_id: categoryId });
      return { ids, categoryId };
    } catch (error) {
      if (isNetworkError(error)) {
        await enqueue({ method: 'PATCH', url: '/api/transactions/bulk/category', data: { transaction_ids: ids, category_id: categoryId }, description: 'Update selected transactions' });
        showToast({ type: 'info', text1: 'Saved offline', text2: 'Will sync when reconnected' });
        return { ids, categoryId };
      }
      return rejectWithValue(errorMessage(error, 'Unable to update selected transactions'));
    }
  }
);

export const fetchTransactionSummary = createAsyncThunk<TransactionSummary, Pick<TransactionFilters, 'start_date' | 'end_date'> | undefined, { rejectValue: string }>(
  'transactions/fetchTransactionSummary',
  async (dateRange = {}, { rejectWithValue }) => {
    try {
      const response = await api.get<TransactionSummary>('/api/transactions/summary', { params: cleanFilters(dateRange) });
      return response.data;
    } catch (error) {
      return rejectWithValue(errorMessage(error, 'Unable to load transaction summary'));
    }
  }
);

export const fetchTransactionById = createAsyncThunk<Transaction, string, { rejectValue: string }>(
  'transactions/fetchTransactionById',
  async (id, { rejectWithValue }) => {
    try {
      const response = await api.get<Transaction>(`/api/transactions/${id}`);
      return response.data;
    } catch (error) {
      return rejectWithValue(errorMessage(error, 'Unable to load transaction'));
    }
  }
);

const transactionsSlice = createSlice({
  name: 'transactions',
  initialState,
  reducers: {
    setTransactions(state, action: PayloadAction<{ transactions: Transaction[]; pagination?: Pagination }>) {
      state.transactions = action.payload.transactions;
      if (action.payload.pagination) state.pagination = action.payload.pagination;
      state.isLoading = false;
      state.error = null;
    },
    setTransactionFilters(state, action: PayloadAction<TransactionFilters>) {
      state.filters = { ...state.filters, ...action.payload, page: 1 };
    },
    setSelectedTransaction(state, action: PayloadAction<Transaction | null>) {
      state.selectedTransaction = action.payload;
    },
    setTransactionsLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload;
    },
    setTransactionsError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
      state.isLoading = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTransactions.pending, (state, action) => {
        state.isLoading = true;
        state.error = null;
        state.filters = { ...state.filters, ...action.meta.arg, page: action.meta.arg?.page || 1, limit: action.meta.arg?.limit || state.filters.limit || 20 };
      })
      .addCase(fetchTransactions.fulfilled, (state, action) => {
        state.transactions = action.payload.data;
        state.pagination = action.payload.pagination;
        state.isLoading = false;
      })
      .addCase(fetchTransactions.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload || 'Unable to load transactions';
      })
      .addCase(fetchMoreTransactions.pending, (state) => {
        state.isLoadingMore = true;
      })
      .addCase(fetchMoreTransactions.fulfilled, (state, action) => {
        if (action.payload) {
          state.transactions = [...state.transactions, ...action.payload.data];
          state.pagination = action.payload.pagination;
        }
        state.isLoadingMore = false;
      })
      .addCase(fetchMoreTransactions.rejected, (state, action) => {
        state.isLoadingMore = false;
        state.error = action.payload || 'Unable to load more transactions';
      })
      .addCase(createTransaction.fulfilled, (state, action) => {
        const created = Array.isArray(action.payload) ? action.payload : [action.payload];
        state.transactions = [...created, ...state.transactions];
      })
      .addCase(updateTransaction.fulfilled, (state, action) => {
        state.transactions = state.transactions.map((transaction) => transaction.id === action.payload.id ? { ...transaction, ...action.payload } : transaction);
        state.selectedTransaction = state.selectedTransaction ? { ...state.selectedTransaction, ...action.payload } : action.payload;
      })
      .addCase(deleteTransaction.fulfilled, (state, action) => {
        state.transactions = state.transactions.filter((transaction) => transaction.id !== action.payload);
        state.selectedTransaction = null;
      })
      .addCase(bulkDeleteTransactions.fulfilled, (state, action) => {
        const deletedIds = new Set(action.payload);
        state.transactions = state.transactions.filter((transaction) => !deletedIds.has(transaction.id));
        if (state.selectedTransaction && deletedIds.has(state.selectedTransaction.id)) state.selectedTransaction = null;
      })
      .addCase(bulkUpdateTransactionCategory.fulfilled, (state, action) => {
        const updatedIds = new Set(action.payload.ids);
        state.transactions = state.transactions.map((transaction) => (
          updatedIds.has(transaction.id) ? { ...transaction, category_id: action.payload.categoryId } : transaction
        ));
        if (state.selectedTransaction && updatedIds.has(state.selectedTransaction.id)) {
          state.selectedTransaction = { ...state.selectedTransaction, category_id: action.payload.categoryId };
        }
      })
      .addCase(fetchTransactionSummary.fulfilled, (state, action) => {
        state.summary = action.payload;
      })
      .addCase(fetchTransactionById.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchTransactionById.fulfilled, (state, action) => {
        state.selectedTransaction = action.payload;
        state.isLoading = false;
      })
      .addCase(fetchTransactionById.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload || 'Unable to load transaction';
      });
  },
});

export const transactionsActions = transactionsSlice.actions;
export default transactionsSlice.reducer;

