export type UserRole = 'user' | 'admin';
export type AccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'cash';
export type TransactionType = 'income' | 'expense' | 'transfer';
export type CategoryType = 'income' | 'expense';
export type BudgetPeriod = 'monthly' | 'weekly' | 'yearly';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: number;
  email_verified_at?: string | null;
  avatar_color?: string | null;
  currency?: string;
  must_change_password?: number;
  has_completed_onboarding?: number;
  last_login?: string | null;
  failed_login_attempts?: number;
  locked_until?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface Account {
  id: string;
  user_id?: string;
  name: string;
  type: AccountType;
  balance: number;
  current_balance?: number;
  overdraft_limit?: number | null;
  currency: string;
  color?: string | null;
  icon?: string | null;
  is_active?: number;
  created_at?: string;
  updated_at?: string | null;
}

export interface Transaction {
  id: string;
  user_id?: string;
  account_id?: string | null;
  to_account_id?: string | null;
  from_account_id?: string | null;
  category_id?: string | null;
  type: TransactionType;
  amount: number;
  description?: string | null;
  note?: string | null;
  date: string;
  recurring?: number;
  recurring_interval?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  receipt_path?: string | null;
  tags?: string | string[] | null;
  transfer_group_id?: string | null;
  transfer_direction?: 'source' | 'destination' | null;
  account_name?: string | null;
  category_name?: string | null;
  user_email?: string | null;
  user_full_name?: string | null;
  admin_deleted_at?: string | null;
  admin_deleted_by?: string | null;
  admin_delete_reason?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface Budget {
  id: string;
  user_id?: string;
  category_id: string;
  amount: number;
  period: BudgetPeriod;
  start_date?: string;
  end_date?: string | null;
  current_spending?: number;
  remaining?: number;
  category_name?: string | null;
  category_icon?: string | null;
  category_color?: string | null;
  weekly_breakdown?: Array<{ week: string; spending: number }>;
  created_at?: string;
  updated_at?: string | null;
}

export interface Category {
  id: string;
  user_id?: string | null;
  name: string;
  type: CategoryType;
  icon?: string | null;
  color?: string | null;
  sort_order?: number;
  is_default?: number;
  is_system?: number;
  is_active?: number;
  created_at?: string;
  updated_at?: string | null;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  is_active?: number;
  starts_at?: string | null;
  ends_at?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface RecurringTransaction extends Transaction {
  recurring: 1;
  recurring_interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  read_at?: string | null;
  created_at: string;
}

export interface PushToken {
  id?: string;
  user_id?: string;
  token: string;
  platform: string;
  created_at?: string;
}

export interface AdminUser extends User {
  account_count?: number;
  transaction_count?: number;
}

export interface AdminStats {
  total_users: { active: number; inactive: number; total: number };
  total_transactions: { count: number; sum: number };
  total_accounts: number;
  deleted_users_count?: number;
  new_users_this_month: number;
  new_transactions_this_month: number;
  top_5_categories_by_spending: Array<{ category_id?: string | null; category_name: string; total: number }>;
  daily_transaction_volume: Array<{ date: string; count: number; total: number }>;
  system_health: { db_size_mb: number; log_count: number; uptime_seconds: number };
  security: { attack_attempts: number; auth_failures: number; total_security_events: number; recent_events: AuditLog[] };
}

export interface AuditLog {
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
}

export interface DeletedUser {
  id: string;
  original_user_id: string;
  email: string;
  full_name: string;
  role?: UserRole;
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
}

export interface ApiToken {
  id: string;
  name: string;
  scopes: string[] | string;
  token?: string;
  created_at?: string;
  revoked_at?: string | null;
}

export interface Webhook {
  id: string;
  name: string;
  url: string;
  event: string;
  secret?: string;
  is_active?: number;
  created_at?: string;
  updated_at?: string | null;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event: string;
  status?: string | null;
  response_status?: number | null;
  error?: string | null;
  created_at: string;
}

export interface SecurityIpBlock {
  ip: string;
  blocked_until?: string | null;
  is_blocked?: boolean;
  reason?: string | null;
}

export interface ActiveSession {
  id: string;
  user_id?: string;
  family_id?: string | null;
  created_at: string;
  last_used_at?: string | null;
  expires_at: string;
  user_agent?: string | null;
}

