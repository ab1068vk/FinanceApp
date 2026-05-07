import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api from '../../services/api';
import { User } from './authSlice';
import { Transaction } from './transactionsSlice';

export type AdminUser = User & {
  account_count?: number;
  transaction_count?: number;
  last_login?: string | null;
  failed_login_attempts?: number;
  locked_until?: string | null;
  created_at?: string;
  updated_at?: string | null;
};

export type AuditLog = {
  id: string;
  user_id?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
  user_email?: string | null;
  user_full_name?: string | null;
};

export type AdminStats = {
  total_users: { active: number; inactive: number; total: number };
  total_transactions: { count: number; sum: number };
  total_accounts: number;
  deleted_users_count?: number;
  new_users_this_month: number;
  new_transactions_this_month: number;
  top_5_categories_by_spending: Array<{ category_id?: string; category_name: string; total: number }>;
  daily_transaction_volume: Array<{ date: string; count: number; total: number }>;
  system_health: { db_size_mb: number; log_count: number; uptime_seconds: number };
  security: {
    attack_attempts: number;
    auth_failures: number;
    total_security_events: number;
    recent_events: AuditLog[];
  };
};

export type SystemHealth = {
  db_size_mb: number;
  log_count: number;
  log_size_mb: number;
  active_sessions: number;
  uptime_seconds: number;
  heap_used_mb?: number;
  heap_limit_mb?: number;
  memory_usage?: { rss?: number; heapTotal?: number; heapUsed?: number; external?: number; arrayBuffers?: number };
  node_version?: string;
};

export type UserDetail = {
  user: AdminUser;
  summary: {
    account_count: number;
    active_account_count: number;
    total_account_balance: number;
    transaction_count: number;
    transaction_total: number;
    budget_count: number;
    refresh_token_count: number;
  };
  recent_audit_logs: AuditLog[];
};

export type DeletedUser = {
  id: string;
  original_user_id: string;
  email: string;
  full_name: string;
  role?: 'user' | 'admin';
  was_active?: number;
  created_at?: string | null;
  last_login?: string | null;
  deleted_at: string;
  deleted_by?: string | null;
  account_count: number;
  transaction_count: number;
  budget_count: number;
  total_account_balance: number;
  transaction_total: number;
};

export type DeletedUserDetail = {
  user: DeletedUser;
  details: {
    accounts?: unknown[];
    transactions?: Transaction[];
    budgets?: unknown[];
    audit_logs?: AuditLog[];
    summary?: {
      account_count: number;
      transaction_count: number;
      budget_count: number;
      total_account_balance: number;
      transaction_total: number;
    };
  };
};

export type Pagination = { page: number; limit: number; total: number; totalPages: number };
export type UsersFilters = { role?: 'user' | 'admin'; is_active?: boolean; search?: string; page?: number; limit?: number; locked?: boolean };
export type AuditFilters = { user_id?: string; action?: string; start_date?: string; end_date?: string; page?: number; limit?: number };
export type UserTransactionFilters = { start_date?: string; end_date?: string; page?: number; limit?: number };
export type SpendingByCategory = { category_id?: string | null; category_name: string; category_color?: string; transaction_count: number; total: number; percent: number };
export type BudgetPerformance = { id: string; category_name?: string | null; amount: number; current_spending: number; remaining: number; percent_used: number; status: 'over' | 'within'; period?: string; start_date?: string; end_date?: string | null };
export type UserExportData = { exported_at: string; user: AdminUser; accounts: unknown[]; transactions: Transaction[]; budgets: unknown[]; audit_logs: AuditLog[] };

type ListResponse<T> = { data: T[]; pagination: Pagination };

type AdminState = {
  stats: AdminStats | null;
  users: AdminUser[];
  deletedUsers: DeletedUser[];
  selectedDeletedUser: DeletedUserDetail | null;
  selectedUser: UserDetail | null;
  selectedUserTransactions: Transaction[];
  selectedUserSpending: SpendingByCategory[];
  selectedUserBudgets: BudgetPerformance[];
  selectedUserLoginHistory: AuditLog[];
  selectedUserExport: UserExportData | null;
  auditLogs: AuditLog[];
  systemHealth: SystemHealth | null;
  pagination: { users: Pagination; deletedUsers: Pagination; auditLogs: Pagination; selectedUserTransactions: Pagination; selectedUserLoginHistory: Pagination };
  isLoading: boolean;
  usersLoading: boolean;
  deletedUsersLoading: boolean;
  currentUsersRequestId: string | null;
  usersLoadingMore: boolean;
  auditLogsLoadingMore: boolean;
  error: string | null;
};

const emptyPagination: Pagination = { page: 1, limit: 20, total: 0, totalPages: 0 };

const initialState: AdminState = {
  stats: null,
  users: [],
  deletedUsers: [],
  selectedDeletedUser: null,
  selectedUser: null,
  selectedUserTransactions: [],
  selectedUserSpending: [],
  selectedUserBudgets: [],
  selectedUserLoginHistory: [],
  selectedUserExport: null,
  auditLogs: [],
  systemHealth: null,
  pagination: { users: emptyPagination, deletedUsers: emptyPagination, auditLogs: { ...emptyPagination, limit: 50 }, selectedUserTransactions: emptyPagination, selectedUserLoginHistory: emptyPagination },
  isLoading: false,
  usersLoading: false,
  deletedUsersLoading: false,
  currentUsersRequestId: null,
  usersLoadingMore: false,
  auditLogsLoadingMore: false,
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

function cleanParams<T extends Record<string, unknown>>(params: T) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function normalizePagination(pagination: Partial<Pagination> | undefined, fallbackLimit: number): Pagination {
  const page = Number(pagination?.page) || 1;
  const limit = Number(pagination?.limit) || fallbackLimit;
  const total = Number(pagination?.total) || 0;
  const totalPages = pagination?.totalPages !== undefined ? Number(pagination.totalPages) || 0 : Math.ceil(total / limit);
  return { page, limit, total, totalPages };
}

function normalizeListResponse<T>(response: Partial<ListResponse<T>> | undefined, fallbackLimit: number): ListResponse<T> {
  return {
    data: Array.isArray(response?.data) ? response.data : [],
    pagination: normalizePagination(response?.pagination, fallbackLimit),
  };
}

export const fetchAdminStats = createAsyncThunk<AdminStats, void, { rejectValue: string }>('admin/fetchAdminStats', async (_, { rejectWithValue }) => {
  try {
    const response = await api.get<AdminStats>('/api/admin/dashboard');
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load admin stats'));
  }
});

export const fetchUsers = createAsyncThunk<ListResponse<AdminUser>, UsersFilters | undefined, { rejectValue: string }>('admin/fetchUsers', async (filters = {}, { rejectWithValue }) => {
  try {
    const response = await api.get<Partial<ListResponse<AdminUser>>>('/api/admin/users', { params: cleanParams({ page: 1, limit: 20, ...filters }) });
    return normalizeListResponse(response.data, 20);
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load users'));
  }
});

export const fetchMoreUsers = createAsyncThunk<ListResponse<AdminUser>, UsersFilters, { rejectValue: string }>('admin/fetchMoreUsers', async (filters, { rejectWithValue }) => {
  try {
    const response = await api.get<Partial<ListResponse<AdminUser>>>('/api/admin/users', { params: cleanParams({ limit: 20, ...filters }) });
    return normalizeListResponse(response.data, 20);
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load more users'));
  }
});

export const fetchDeletedUsers = createAsyncThunk<ListResponse<DeletedUser>, { search?: string; page?: number; limit?: number } | undefined, { rejectValue: string }>('admin/fetchDeletedUsers', async (filters = {}, { rejectWithValue }) => {
  try {
    const response = await api.get<ListResponse<DeletedUser>>('/api/admin/deleted-users', { params: cleanParams({ page: 1, limit: 20, ...filters }) });
    return { data: response.data.data || [], pagination: normalizePagination(response.data.pagination, 20) };
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load deleted users'));
  }
});

export const fetchDeletedUserDetail = createAsyncThunk<DeletedUserDetail, string, { rejectValue: string }>('admin/fetchDeletedUserDetail', async (id, { rejectWithValue }) => {
  try {
    const response = await api.get<DeletedUserDetail>(`/api/admin/deleted-users/${id}`);
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load deleted user'));
  }
});

export const fetchUserDetail = createAsyncThunk<UserDetail, string, { rejectValue: string }>('admin/fetchUserDetail', async (id, { rejectWithValue }) => {
  try {
    const response = await api.get<UserDetail>(`/api/admin/users/${id}`);
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load user'));
  }
});

export const updateUserStatus = createAsyncThunk<AdminUser, { id: string; isActive: boolean }, { rejectValue: string }>('admin/updateUserStatus', async ({ id, isActive }, { rejectWithValue }) => {
  try {
    const response = await api.put<AdminUser>(`/api/admin/users/${id}/status`, { is_active: isActive });
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to update user status'));
  }
});

export const updateUserRole = createAsyncThunk<AdminUser, { id: string; role: 'user' | 'admin' }, { rejectValue: string }>('admin/updateUserRole', async ({ id, role }, { rejectWithValue }) => {
  try {
    const response = await api.put<AdminUser>(`/api/admin/users/${id}/role`, { role });
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to update user role'));
  }
});

export const resetUserPassword = createAsyncThunk<{ success: boolean; must_change_password: boolean }, { id: string; tempPassword: string }, { rejectValue: string }>('admin/resetUserPassword', async ({ id, tempPassword }, { rejectWithValue }) => {
  try {
    const response = await api.post<{ success: boolean; must_change_password: boolean }>(`/api/admin/users/${id}/reset-password`, { temporary_password: tempPassword });
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to reset password'));
  }
});

export const fetchAuditLogs = createAsyncThunk<ListResponse<AuditLog>, AuditFilters | undefined, { rejectValue: string }>('admin/fetchAuditLogs', async (filters = {}, { rejectWithValue }) => {
  try {
    const response = await api.get<ListResponse<AuditLog>>('/api/admin/audit-logs', { params: cleanParams({ page: 1, limit: 50, ...filters }) });
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load audit logs'));
  }
});

export const fetchMoreAuditLogs = createAsyncThunk<ListResponse<AuditLog>, AuditFilters, { rejectValue: string }>('admin/fetchMoreAuditLogs', async (filters, { rejectWithValue }) => {
  try {
    const response = await api.get<ListResponse<AuditLog>>('/api/admin/audit-logs', { params: cleanParams({ limit: 50, ...filters }) });
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load more audit logs'));
  }
});

export const fetchSystemHealth = createAsyncThunk<SystemHealth, void, { rejectValue: string }>('admin/fetchSystemHealth', async (_, { rejectWithValue }) => {
  try {
    const response = await api.get<SystemHealth>('/api/admin/system-health');
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load system health'));
  }
});

export const fetchUserTransactions = createAsyncThunk<ListResponse<Transaction>, { id: string; filters?: UserTransactionFilters }, { rejectValue: string }>('admin/fetchUserTransactions', async ({ id, filters = {} }, { rejectWithValue }) => {
  try {
    const response = await api.get<ListResponse<Transaction>>(`/api/admin/users/${id}/transactions`, { params: cleanParams({ page: 1, limit: 20, ...filters }) });
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load user transactions'));
  }
});

export const fetchUserSpendingByCategory = createAsyncThunk<{ data: SpendingByCategory[]; total: number }, { id: string; filters?: Pick<UserTransactionFilters, 'start_date' | 'end_date'> }, { rejectValue: string }>('admin/fetchUserSpendingByCategory', async ({ id, filters = {} }, { rejectWithValue }) => {
  try {
    const response = await api.get<{ data: SpendingByCategory[]; total: number }>(`/api/admin/users/${id}/spending-by-category`, { params: cleanParams(filters) });
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load user spending'));
  }
});

export const fetchUserBudgetPerformance = createAsyncThunk<BudgetPerformance[], string, { rejectValue: string }>('admin/fetchUserBudgetPerformance', async (id, { rejectWithValue }) => {
  try {
    const response = await api.get<{ data: BudgetPerformance[] }>(`/api/admin/users/${id}/budget-performance`);
    return response.data.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load budget performance'));
  }
});

export const fetchUserLoginHistory = createAsyncThunk<ListResponse<AuditLog>, { id: string; filters?: AuditFilters }, { rejectValue: string }>('admin/fetchUserLoginHistory', async ({ id, filters = {} }, { rejectWithValue }) => {
  try {
    const response = await api.get<ListResponse<AuditLog>>(`/api/admin/users/${id}/login-history`, { params: cleanParams({ page: 1, limit: 20, ...filters }) });
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to load login history'));
  }
});

export const exportUserData = createAsyncThunk<UserExportData, string, { rejectValue: string }>('admin/exportUserData', async (id, { rejectWithValue }) => {
  try {
    const response = await api.get<UserExportData>(`/api/admin/users/${id}/export`);
    return response.data;
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to export user data'));
  }
});

export const deleteUserPermanently = createAsyncThunk<{ success: boolean; deleted: boolean; id: string }, string, { rejectValue: string }>('admin/deleteUserPermanently', async (id, { rejectWithValue }) => {
  try {
    let response = await api.delete<{ success: boolean; deleted: boolean; requires_confirmation?: boolean; confirmation_token?: string }>(`/api/admin/users/${id}`);
    if (response.data.requires_confirmation && response.data.confirmation_token) {
      response = await api.delete<{ success: boolean; deleted: boolean }>(`/api/admin/users/${id}`, {
        data: { confirmation_token: response.data.confirmation_token },
      });
    }
    return { ...response.data, id };
  } catch (error) {
    return rejectWithValue(errorMessage(error, 'Unable to delete user'));
  }
});

const adminSlice = createSlice({
  name: 'admin',
  initialState,
  reducers: {
    clearSelectedUser(state) {
      state.selectedUser = null;
      state.selectedDeletedUser = null;
      state.selectedUserTransactions = [];
      state.selectedUserSpending = [];
      state.selectedUserBudgets = [];
      state.selectedUserLoginHistory = [];
      state.selectedUserExport = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdminStats.pending, (state) => { state.isLoading = true; state.error = null; })
      .addCase(fetchAdminStats.fulfilled, (state, action) => { state.stats = action.payload; state.isLoading = false; })
      .addCase(fetchAdminStats.rejected, (state, action) => { state.isLoading = false; state.error = action.payload || 'Unable to load admin stats'; })
      .addCase(fetchUsers.pending, (state, action) => {
        state.isLoading = true;
        state.usersLoading = true;
        state.currentUsersRequestId = action.meta.requestId;
        state.error = null;
      })
      .addCase(fetchUsers.fulfilled, (state, action) => {
        if (state.currentUsersRequestId !== action.meta.requestId) return;
        state.users = action.payload.data;
        state.pagination.users = action.payload.pagination;
        state.isLoading = false;
        state.usersLoading = false;
        state.currentUsersRequestId = null;
      })
      .addCase(fetchUsers.rejected, (state, action) => {
        if (state.currentUsersRequestId !== action.meta.requestId) return;
        state.isLoading = false;
        state.usersLoading = false;
        state.currentUsersRequestId = null;
        state.error = action.payload || 'Unable to load users';
      })
      .addCase(fetchMoreUsers.pending, (state) => {
        state.usersLoadingMore = true;
      })
      .addCase(fetchMoreUsers.fulfilled, (state, action) => {
        state.users = [...state.users, ...action.payload.data];
        state.pagination.users = action.payload.pagination;
        state.usersLoadingMore = false;
      })
      .addCase(fetchMoreUsers.rejected, (state, action) => {
        state.usersLoadingMore = false;
        state.error = action.payload || 'Unable to load more users';
      })
      .addCase(fetchDeletedUsers.pending, (state) => {
        state.deletedUsersLoading = true;
        state.error = null;
      })
      .addCase(fetchDeletedUsers.fulfilled, (state, action) => {
        state.deletedUsers = action.payload.data;
        state.pagination.deletedUsers = action.payload.pagination;
        state.deletedUsersLoading = false;
      })
      .addCase(fetchDeletedUsers.rejected, (state, action) => {
        state.deletedUsersLoading = false;
        state.error = action.payload || 'Unable to load deleted users';
      })
      .addCase(fetchDeletedUserDetail.pending, (state) => { state.isLoading = true; state.error = null; })
      .addCase(fetchDeletedUserDetail.fulfilled, (state, action) => { state.selectedDeletedUser = action.payload; state.isLoading = false; })
      .addCase(fetchDeletedUserDetail.rejected, (state, action) => { state.isLoading = false; state.error = action.payload || 'Unable to load deleted user'; })
      .addCase(fetchUserDetail.pending, (state) => { state.isLoading = true; state.error = null; })
      .addCase(fetchUserDetail.fulfilled, (state, action) => { state.selectedUser = action.payload; state.isLoading = false; })
      .addCase(fetchUserDetail.rejected, (state, action) => { state.isLoading = false; state.error = action.payload || 'Unable to load user'; })
      .addCase(updateUserStatus.fulfilled, (state, action) => {
        state.users = state.users.map((user) => user.id === action.payload.id ? { ...user, ...action.payload } : user);
        if (state.selectedUser?.user.id === action.payload.id) state.selectedUser.user = { ...state.selectedUser.user, ...action.payload };
      })
      .addCase(updateUserRole.fulfilled, (state, action) => {
        state.users = state.users.map((user) => user.id === action.payload.id ? { ...user, ...action.payload } : user);
        if (state.selectedUser?.user.id === action.payload.id) state.selectedUser.user = { ...state.selectedUser.user, ...action.payload };
      })
      .addCase(fetchAuditLogs.pending, (state) => { state.isLoading = true; state.error = null; })
      .addCase(fetchAuditLogs.fulfilled, (state, action) => { state.auditLogs = action.payload.data; state.pagination.auditLogs = action.payload.pagination; state.isLoading = false; })
      .addCase(fetchAuditLogs.rejected, (state, action) => { state.isLoading = false; state.error = action.payload || 'Unable to load audit logs'; })
      .addCase(fetchMoreAuditLogs.pending, (state) => { state.auditLogsLoadingMore = true; })
      .addCase(fetchMoreAuditLogs.fulfilled, (state, action) => {
        state.auditLogs = [...state.auditLogs, ...action.payload.data];
        state.pagination.auditLogs = action.payload.pagination;
        state.auditLogsLoadingMore = false;
      })
      .addCase(fetchMoreAuditLogs.rejected, (state, action) => { state.auditLogsLoadingMore = false; state.error = action.payload || 'Unable to load more audit logs'; })
      .addCase(fetchSystemHealth.fulfilled, (state, action) => { state.systemHealth = action.payload; })
      .addCase(fetchUserTransactions.fulfilled, (state, action) => {
        state.selectedUserTransactions = action.payload.data;
        state.pagination.selectedUserTransactions = action.payload.pagination;
      })
      .addCase(fetchUserSpendingByCategory.fulfilled, (state, action) => { state.selectedUserSpending = action.payload.data; })
      .addCase(fetchUserBudgetPerformance.fulfilled, (state, action) => { state.selectedUserBudgets = action.payload; })
      .addCase(fetchUserLoginHistory.fulfilled, (state, action) => {
        state.selectedUserLoginHistory = action.payload.data;
        state.pagination.selectedUserLoginHistory = action.payload.pagination;
      })
      .addCase(exportUserData.fulfilled, (state, action) => { state.selectedUserExport = action.payload; })
      .addCase(deleteUserPermanently.fulfilled, (state, action) => {
        state.users = state.users.filter((user) => user.id !== action.payload.id);
        if (state.selectedUser?.user.id === action.payload.id) state.selectedUser = null;
      });
  },
});

export const adminActions = adminSlice.actions;
export default adminSlice.reducer;
