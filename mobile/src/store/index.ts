import { combineReducers, configureStore, createSlice, PayloadAction } from '@reduxjs/toolkit';
import authReducer, { authActions, User } from './slices/authSlice';
import accountsReducer, { accountsActions, Account } from './slices/accountsSlice';
import transactionsReducer, { transactionsActions, Transaction, Pagination } from './slices/transactionsSlice';
import adminReducer, { adminActions } from './slices/adminSlice';
import budgetsReducer, { budgetsActions, Budget, createBudget, fetchBudgets } from './slices/budgetsSlice';

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    activeTab: 'Dashboard',
    isOnline: true,
    modals: {} as Record<string, boolean>,
    toast: null as { type: 'success' | 'error' | 'info'; message: string } | null,
  },
  reducers: {
    setOnline(state, action: PayloadAction<boolean>) {
      state.isOnline = action.payload;
    },
    setActiveTab(state, action: PayloadAction<string>) {
      state.activeTab = action.payload;
    },
    setModalVisible(state, action: PayloadAction<{ name: string; visible: boolean }>) {
      state.modals[action.payload.name] = action.payload.visible;
    },
    setToast(state, action: PayloadAction<{ type: 'success' | 'error' | 'info'; message: string } | null>) {
      state.toast = action.payload;
    },
  },
});

const appReducer = combineReducers({
  auth: authReducer,
  accounts: accountsReducer,
  transactions: transactionsReducer,
  budgets: budgetsReducer,
  ui: uiSlice.reducer,
  admin: adminReducer,
});

const rootReducer: typeof appReducer = (state, action) => {
  if (
    action.type === authActions.logout.type
    || action.type === 'auth/logoutUser/fulfilled'
    || action.type === 'auth/refreshAccessToken/rejected'
  ) {
    return appReducer(undefined, action);
  }

  return appReducer(state, action);
};

export const store = configureStore({
  reducer: rootReducer,
});

export { authActions };
export { accountsActions };
export type { Account };
export { transactionsActions };
export type { Transaction, Pagination };
export { budgetsActions, createBudget, fetchBudgets };
export type { Budget };
export const uiActions = uiSlice.actions;
export { adminActions };

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
