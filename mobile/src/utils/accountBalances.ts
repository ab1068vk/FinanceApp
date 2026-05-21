import { formatCurrency } from './formatters';

export type BalanceAccount = {
  balance?: number | null;
  current_balance?: number | null;
  currency?: string | null;
};

export type CurrencyBalance = {
  currency: string;
  amount: number;
};

export function accountBalance(account: BalanceAccount) {
  const amount = Number(account.current_balance ?? account.balance ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function accountCurrency(account: BalanceAccount) {
  return (account.currency || 'USD').trim().toUpperCase() || 'USD';
}

export function groupAccountBalancesByCurrency(accounts: BalanceAccount[]) {
  const totals = new Map<string, number>();

  for (const account of accounts) {
    const currency = accountCurrency(account);
    totals.set(currency, (totals.get(currency) || 0) + accountBalance(account));
  }

  return Array.from(totals, ([currency, amount]) => ({ currency, amount }));
}

export function formatCurrencyBalanceGroup(group: CurrencyBalance, options: Intl.NumberFormatOptions = {}) {
  return formatCurrency(group.amount, group.currency, 'en-US', options);
}

export function formatAccountBalanceSummary(groups: CurrencyBalance[], options: Intl.NumberFormatOptions = {}) {
  if (groups.length === 0) return formatCurrency(0, 'USD', 'en-US', options);
  const firstGroup = groups[0];
  if (groups.length === 1 && firstGroup) return formatCurrencyBalanceGroup(firstGroup, options);
  return groups.map((group) => `${group.currency} ${formatCurrencyBalanceGroup(group, options)}`).join(' | ');
}

export function hasMixedCurrencies(groups: CurrencyBalance[]) {
  return groups.length > 1;
}
