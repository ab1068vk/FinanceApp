import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import api from '../../services/api';
import { getApiErrorMessage } from '../../services/apiErrors';
import { showToast } from '../../components/common/Toast';
import { ListPayload, unwrapList } from '../../types/api';
import { enqueue } from '../../utils/offlineQueue';

export type Budget = {
  id: string;
  category_id: string;
  amount: number;
  period: 'monthly' | 'weekly' | 'yearly';
  current_spending?: number;
  remaining?: number;
  category_name?: string;
  category_icon?: string;
  category_color?: string;
  start_date?: string;
  end_date?: string | null;
  weekly_breakdown?: Array<{ week: string; spending: number }>;
};

type BudgetsState = {
  budgets: Budget[];
  isLoading: boolean;
  error: string | null;
};

export type CreateBudgetData = {
  category_id: string;
  amount: number;
  period: 'monthly' | 'weekly' | 'yearly';
  start_date: string;
  end_date?: string | null;
};

const initialState: BudgetsState = {
  budgets: [],
  isLoading: false,
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

export const fetchBudgets = createAsyncThunk<Budget[], void, { rejectValue: string }>(
  'budgets/fetchBudgets',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.get<ListPayload<Budget>>('/api/budgets', { params: { page: 1, limit: 200 } });
      return unwrapList(response.data);
    } catch (error) {
      return rejectWithValue(errorMessage(error, 'Unable to load budgets'));
    }
  }
);

export const createBudget = createAsyncThunk<Budget, CreateBudgetData, { rejectValue: string }>(
  'budgets/createBudget',
  async (data, { rejectWithValue }) => {
    try {
      const response = await api.post<Budget>('/api/budgets', data);
      return response.data;
    } catch (error) {
      if (isNetworkError(error)) {
        await enqueue({ method: 'POST', url: '/api/budgets', data, description: 'Create budget' });
        showToast({ type: 'info', text1: 'Saved offline', text2: 'Will sync when reconnected' });
        return { ...data, id: tempId(), current_spending: 0, remaining: data.amount };
      }
      return rejectWithValue(errorMessage(error, 'Unable to create budget'));
    }
  }
);

const budgetsSlice = createSlice({
  name: 'budgets',
  initialState,
  reducers: {
    setBudgets(state, action: PayloadAction<Budget[]>) {
      state.budgets = action.payload;
      state.isLoading = false;
      state.error = null;
    },
    setBudgetsLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload;
    },
    setBudgetsError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
      state.isLoading = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBudgets.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchBudgets.fulfilled, (state, action) => {
        state.budgets = action.payload;
        state.isLoading = false;
        state.error = null;
      })
      .addCase(fetchBudgets.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload || 'Unable to load budgets';
      })
      .addCase(createBudget.fulfilled, (state, action) => {
        state.budgets.unshift(action.payload);
      });
  },
});

export const budgetsActions = budgetsSlice.actions;
export default budgetsSlice.reducer;
