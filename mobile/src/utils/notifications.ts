import { addDays, addMonths, addWeeks, addYears, differenceInCalendarDays, format, isBefore, startOfDay } from 'date-fns';
import type { Budget, Transaction } from '../store';

export type NotificationKind = 'announcement' | 'budget' | 'large-transaction' | 'recurring' | 'admin-action';
export type NotificationSeverity = 'critical' | 'warning' | 'info';

export type AnnouncementNotificationSource = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

export type ServerNotificationSource = {
  id: string;
  type: string;
  title: string;
  body: string;
  data_json?: string | null;
  read_at?: string | null;
  created_at: string;
};

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  message: string;
  detail: string;
  date: string;
  amount?: number;
  action?: { type: 'announcement' | 'budget' | 'transaction'; id: string };
};

const LARGE_TRANSACTION_THRESHOLD = 500;
const LARGE_TRANSACTION_WINDOW_DAYS = 14;
const RECURRING_REMINDER_WINDOW_DAYS = 7;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
}

function safeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addInterval(date: Date, interval: Transaction['recurring_interval']) {
  if (interval === 'daily') return addDays(date, 1);
  if (interval === 'weekly') return addWeeks(date, 1);
  if (interval === 'yearly') return addYears(date, 1);
  return addMonths(date, 1);
}

export function getNextRecurringDate(transaction: Transaction, today = new Date()) {
  const firstDate = safeDate(transaction.date);
  if (!firstDate || !transaction.recurring_interval) return null;

  let nextDate = startOfDay(firstDate);
  const todayStart = startOfDay(today);
  let guard = 0;

  while (isBefore(nextDate, todayStart) && guard < 500) {
    nextDate = addInterval(nextDate, transaction.recurring_interval);
    guard += 1;
  }

  return nextDate;
}

function budgetNotifications(budgets: Budget[], today: Date): AppNotification[] {
  return budgets
    .filter((budget) => Number(budget.amount || 0) > 0)
    .map<AppNotification | null>((budget) => {
      const amount = Number(budget.amount || 0);
      const spent = Number(budget.current_spending || 0);
      const overage = spent - amount;
      const ratio = spent / amount;

      if (overage <= 0) return null;

      const category = String(budget.category_name || 'Budget');
      return {
        id: `budget-${budget.id}`,
        kind: 'budget' as const,
        severity: 'critical' as const,
        title: `${category} budget exceeded`,
        message: `${formatCurrency(spent)} spent against a ${formatCurrency(amount)} ${budget.period} budget.`,
        detail: `${formatCurrency(overage)} over budget | ${Math.round(ratio * 100)}% used`,
        date: today.toISOString(),
        amount: overage,
        action: { type: 'budget' as const, id: budget.id },
      };
    })
    .filter(isNotification);
}

function largeTransactionNotifications(transactions: Transaction[], today: Date): AppNotification[] {
  return transactions
    .map<AppNotification | null>((transaction) => {
      const date = safeDate(transaction.date);
      if (!date) return null;

      const ageDays = differenceInCalendarDays(startOfDay(today), startOfDay(date));
      const amount = Number(transaction.amount || 0);
      if (ageDays < 0 || ageDays > LARGE_TRANSACTION_WINDOW_DAYS || amount < LARGE_TRANSACTION_THRESHOLD) return null;

      const label = transaction.description || transaction.category_name || 'Large transaction';
      return {
        id: `large-${transaction.id}`,
        kind: 'large-transaction' as const,
        severity: amount >= LARGE_TRANSACTION_THRESHOLD * 2 ? 'warning' as const : 'info' as const,
        title: `Large ${transaction.type} recorded`,
        message: `${label} was ${formatCurrency(amount)} on ${format(date, 'MMM d')}.`,
        detail: transaction.account_name ? `Account: ${transaction.account_name}` : 'Review the transaction details',
        date: date.toISOString(),
        amount,
        action: { type: 'transaction' as const, id: transaction.id },
      };
    })
    .filter(isNotification);
}

function recurringNotifications(transactions: Transaction[], today: Date): AppNotification[] {
  return transactions
    .filter((transaction) => Boolean(transaction.recurring) && Boolean(transaction.recurring_interval))
    .map<AppNotification | null>((transaction) => {
      const nextDate = getNextRecurringDate(transaction, today);
      if (!nextDate) return null;

      const daysUntil = differenceInCalendarDays(nextDate, startOfDay(today));
      if (daysUntil > RECURRING_REMINDER_WINDOW_DAYS) return null;

      const label = transaction.description || transaction.category_name || 'Recurring transaction';
      const dueText = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;

      return {
        id: `recurring-${transaction.id}`,
        kind: 'recurring' as const,
        severity: daysUntil <= 1 ? 'warning' as const : 'info' as const,
        title: `${label} is due ${dueText}`,
        message: `${formatCurrency(Number(transaction.amount || 0))} ${transaction.recurring_interval} ${transaction.type} reminder.`,
        detail: `Next date: ${format(nextDate, 'MMM d, yyyy')}`,
        date: nextDate.toISOString(),
        amount: Number(transaction.amount || 0),
        action: { type: 'transaction' as const, id: transaction.id },
      };
    })
    .filter(isNotification);
}

function announcementNotifications(announcements: AnnouncementNotificationSource[]): AppNotification[] {
  return announcements.map((announcement) => ({
    id: `announcement-${announcement.id}`,
    kind: 'announcement' as const,
    severity: 'info' as const,
    title: announcement.title || 'Admin announcement',
    message: announcement.body || '',
    detail: 'Admin message',
    date: safeDate(announcement.created_at)?.toISOString() || new Date().toISOString(),
    action: { type: 'announcement' as const, id: announcement.id },
  }));
}

function serverNotifications(notifications: ServerNotificationSource[]): AppNotification[] {
  return notifications.map((notification) => {
    let detail = 'Account notice';
    try {
      const data = notification.data_json ? JSON.parse(notification.data_json) : null;
      if (data?.reason) detail = `Reason: ${data.reason}`;
    } catch {
      detail = notification.type;
    }

    return {
      id: `server-${notification.id}`,
      kind: 'admin-action' as const,
      severity: 'warning' as const,
      title: notification.title || 'Admin action',
      message: notification.body || '',
      detail,
      date: safeDate(notification.created_at)?.toISOString() || new Date().toISOString(),
    };
  });
}

function isNotification(item: AppNotification | null): item is AppNotification {
  return Boolean(item);
}

function severityRank(severity: NotificationSeverity) {
  if (severity === 'critical') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

export function buildNotifications(
  budgets: Budget[],
  transactions: Transaction[],
  today = new Date(),
  announcements: AnnouncementNotificationSource[] = [],
  persistedNotifications: ServerNotificationSource[] = []
) {
  return [
    ...serverNotifications(persistedNotifications),
    ...announcementNotifications(announcements),
    ...budgetNotifications(budgets, today),
    ...largeTransactionNotifications(transactions, today),
    ...recurringNotifications(transactions, today),
  ].sort((left, right) => {
    const severityDelta = severityRank(left.severity) - severityRank(right.severity);
    if (severityDelta !== 0) return severityDelta;
    return new Date(right.date).getTime() - new Date(left.date).getTime();
  });
}
