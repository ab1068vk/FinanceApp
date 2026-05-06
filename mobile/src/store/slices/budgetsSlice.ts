import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import api from '../../services/api';
import { ListPayload, unwrapList } from '../../types/api';

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

const initialState: BudgetsState = {
  budgets: [],
  isLoading: false,
  error: null,
};

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    return response?.data?.error || fallback;
  }

  if (error instanceof Error) return error.message;
  return fallback;
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
      });
  },
});

export const budgetsActions = budgetsSlice.actions;
export default budgetsSlice.reducer;
