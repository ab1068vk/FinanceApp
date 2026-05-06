import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';

export function formatCurrency(amount = 0, currencyCode = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(Number(amount) || 0);
}

export function formatDate(date: string | Date, dateStyle: Intl.DateTimeFormatOptions['dateStyle'] = 'medium', locale = 'en-US') {
  const value = typeof date === 'string' ? new Date(date) : date;
  return Number.isNaN(value.getTime()) ? '' : new Intl.DateTimeFormat(locale, { dateStyle }).format(value);
}

export function formatRelativeDate(date: string | Date) {
  const value = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return '';
  if (isToday(value)) return 'Today';
  if (isYesterday(value)) return 'Yesterday';
  return formatDistanceToNow(value, { addSuffix: true }).replace('about ', '');
}

export function formatPercent(value = 0, total = 0) {
  if (!total) return '0.0%';
  return `${((Number(value) / Number(total)) * 100).toFixed(1)}%`;
}

export function truncateText(text = '', maxLength = 24) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(maxLength - 3, 0))}...`;
}

export function formatAccountType(type = '') {
  return `${type.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())} Account`.trim();
}
