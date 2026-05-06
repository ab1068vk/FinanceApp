import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useFocusEffect } from '@react-navigation/native';
import Feather from '@expo/vector-icons/Feather';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { format, subDays } from 'date-fns';
import api from '../../services/api';
import { showToast } from '../../components/common/Toast';
import { IncomeExpenseBarChart, BarDatum } from '../../components/charts/IncomeExpenseBarChart';
import { SpendingDonutChart, DonutSegment } from '../../components/charts/SpendingDonutChart';
import { TrendLineChart, TrendDatum } from '../../components/charts/TrendLineChart';
import { Transaction } from '../../store';
import type { FeatherIconName } from '../../utils/icons';

type Period = 'week' | 'month' | 'quarter' | 'year' | 'custom';
type CategoryTotal = { label: string; value: number; color: string; percent: number };

const width = Dimensions.get('window').width - 40;
const colors = ['#E94560', '#0F3460', '#27AE60', '#F39C12', '#8B5CF6', '#14B8A6', '#E74C3C', '#6C757D'];

function startOfUtcDay(date: Date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function endOfUtcDay(date: Date) {
  const result = new Date(date);
  result.setUTCHours(23, 59, 59, 999);
  return result;
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function utcMonthStart(date: Date, offset = 0) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1, 0, 0, 0, 0));
}

function endOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86400000);
}

function rangeFor(period: Period) {
  const now = new Date();
  if (period === 'week') {
    return { start: startOfUtcDay(subDays(now, 6)), end: endOfUtcDay(now) };
  }
  if (period === 'quarter') {
    return { start: utcMonthStart(now, -2), end: endOfUtcMonth(now) };
  }
  if (period === 'year') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
    return { start, end };
  }
  if (period === 'custom') {
    return { start: startOfUtcDay(subDays(now, 29)), end: endOfUtcDay(now) };
  }
  return { start: startOfUtcMonth(now), end: endOfUtcMonth(now) };
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeDate(dateLike: string | Date) {
  if (dateLike instanceof Date) return dateLike;
  const value = dateLike.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`);
  if (/T/.test(value) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return new Date(`${value}Z`);
  return new Date(value);
}

function parseStoredDate(date: string | Date) {
  const parsed = normalizeDate(date);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function utcMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function utcMonthLabel(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date);
}

function formatUtcDayLabel(date: Date, pattern: 'day' | 'monthDay') {
  const timeZone = 'UTC';
  if (pattern === 'monthDay') {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(date);
  }
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone }).format(date);
}

function formatUtcRangeDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function getCategory(transaction: Transaction) {
  return String(transaction.category_name || 'Uncategorized');
}

function reportRangeLabel(period: Period) {
  const range = rangeFor(period);
  return `${formatUtcRangeDate(range.start)} - ${formatUtcRangeDate(range.end)}`;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safeText) ? `"${safeText.replace(/"/g, '""')}"` : safeText;
}

function csvRow(values: unknown[]) {
  return values.map(csvCell).join(',');
}

function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function downloadWebFile(contents: string, filename: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function printWebHtml(html: string) {
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    throw new Error('Allow popups to export this report as a PDF.');
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

async function writeTextFile(filename: string, contents: string, mimeType: string) {
  if (Platform.OS === 'web') {
    downloadWebFile(contents, filename, mimeType);
    return null;
  }

  const file = new FileSystem.File(FileSystem.Paths.document, filename);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(contents);
  return file.uri;
}

async function shareFile(uri: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }

  await Sharing.shareAsync(uri, { mimeType });
}

async function fetchTransactions(params: Record<string, unknown>, signal?: AbortSignal) {
  try {
    const response = await api.get<{ data: Transaction[] }>('/api/transactions', { params, signal });
    return response.data.data || [];
  } catch (error) {
    if (Number(params.limit) > 100) {
      const response = await api.get<{ data: Transaction[] }>('/api/transactions', { params: { ...params, limit: 100 }, signal });
      return response.data.data || [];
    }
    throw error;
  }
}

export default function ReportsScreen() {
  const [period, setPeriod] = useState<Period>('year');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [trendTransactions, setTrendTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeReportsRequest = useRef<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadReports = useCallback(async (signal?: AbortSignal) => {
    const range = rangeFor(period);
    const requestKey = `${period}:${range.start.toISOString()}:${range.end.toISOString()}`;
    if (activeReportsRequest.current === requestKey) return;
    activeReportsRequest.current = requestKey;
    setLoading(true);
    setError(null);
    const trendStart = utcMonthStart(new Date(), -5);

    try {
      const [periodTransactions, recentTransactions] = await Promise.all([
        fetchTransactions({ start_date: range.start.toISOString(), end_date: range.end.toISOString(), limit: 500 }, signal),
        fetchTransactions({ start_date: trendStart.toISOString(), end_date: new Date().toISOString(), limit: 1000 }, signal),
      ]);
      if (signal?.aborted || !isMounted.current) return;
      if (activeReportsRequest.current !== requestKey) return;
      setTransactions(periodTransactions);
      setTrendTransactions(recentTransactions);
    } catch {
      if (signal?.aborted || !isMounted.current) return;
      if (activeReportsRequest.current !== requestKey) return;
      setError('Unable to load reports. Pull to refresh and try again.');
      setTransactions([]);
      setTrendTransactions([]);
    } finally {
      const shouldStopLoading = activeReportsRequest.current === requestKey;
      if (shouldStopLoading) {
        activeReportsRequest.current = null;
      }
      if (isMounted.current && shouldStopLoading) {
        setLoading(false);
      }
    }
  }, [period]);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      loadReports(controller.signal);
      return () => controller.abort();
    }, [loadReports]),
  );

  const overview = useMemo(() => buildDailyOverview(transactions, period), [transactions, period]);
  const categoryTotals = useMemo(() => buildCategoryTotals(transactions), [transactions]);
  const barData = useMemo(() => buildBarData(transactions, period), [transactions, period]);
  const trendData = useMemo(() => buildTrendData(trendTransactions), [trendTransactions]);
  const totalSpending = categoryTotals.reduce((sum, item) => sum + item.value, 0);
  const totalIncome = transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const totalExpense = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  const net = totalIncome - totalExpense;
  const reportTitle = `Finance Report - ${period}`;
  const rangeLabel = reportRangeLabel(period);

  const lineChartData = {
    labels: overview.labels,
    datasets: [
      { data: overview.income, color: () => '#27AE60', strokeWidth: 2 },
      { data: overview.expense, color: () => '#E74C3C', strokeWidth: 3 },
    ],
    legend: ['Income', 'Expense'],
  };

  const buildCsv = useCallback(() => {
    const rows = [
      csvRow(['Finance Report']),
      csvRow(['Period', period]),
      csvRow(['Range', rangeLabel]),
      csvRow(['Generated At', new Date().toISOString()]),
      '',
      csvRow(['Summary']),
      csvRow(['Metric', 'Amount']),
      csvRow(['Income', totalIncome]),
      csvRow(['Expenses', totalExpense]),
      csvRow(['Net', net]),
      csvRow(['Transaction Count', transactions.length]),
      '',
      csvRow(['Spending By Category']),
      csvRow(['Category', 'Amount', 'Percent']),
      ...categoryTotals.map((item) => csvRow([item.label, item.value, `${item.percent.toFixed(2)}%`])),
      '',
      csvRow(['Transactions']),
      csvRow(['Date', 'Type', 'Category', 'Account', 'Description', 'Amount']),
      ...transactions.map((transaction) => csvRow([
        dateKey(parseStoredDate(transaction.date)),
        transaction.type,
        transaction.category_name || 'Uncategorized',
        transaction.account_name || '',
        transaction.description || '',
        transaction.amount,
      ])),
    ];

    return rows.join('\n');
  }, [categoryTotals, net, period, rangeLabel, totalExpense, totalIncome, transactions]);

  const buildPdfHtml = useCallback(() => {
    const categoryRows = categoryTotals.length
      ? categoryTotals.map((item) => `<tr><td>${htmlEscape(item.label)}</td><td>${formatCurrency(item.value)}</td><td>${item.percent.toFixed(1)}%</td></tr>`).join('')
      : '<tr><td colspan="3">No category spending for this period.</td></tr>';
    const transactionRows = transactions.length
      ? transactions.map((transaction) => `
          <tr>
            <td>${htmlEscape(dateKey(parseStoredDate(transaction.date)))}</td>
            <td>${htmlEscape(transaction.type)}</td>
            <td>${htmlEscape(transaction.category_name || 'Uncategorized')}</td>
            <td>${htmlEscape(transaction.account_name || '')}</td>
            <td>${htmlEscape(transaction.description || '')}</td>
            <td>${formatCurrency(transaction.amount)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="6">No transactions for this period.</td></tr>';

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { font-family: Arial, sans-serif; color: #1A1A2E; padding: 28px; }
            h1 { margin: 0 0 6px; font-size: 28px; }
            h2 { margin: 28px 0 10px; font-size: 18px; }
            .muted { color: #6C757D; font-size: 13px; }
            .summary { display: flex; gap: 12px; margin-top: 22px; }
            .box { flex: 1; border: 1px solid #DEE2E6; border-radius: 8px; padding: 14px; }
            .label { color: #6C757D; font-size: 12px; font-weight: 700; text-transform: uppercase; }
            .value { font-size: 22px; font-weight: 800; margin-top: 6px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #F5F5F5; text-align: left; }
            th, td { border: 1px solid #DEE2E6; padding: 8px; vertical-align: top; }
          </style>
        </head>
        <body>
          <h1>${htmlEscape(reportTitle)}</h1>
          <div class="muted">${htmlEscape(rangeLabel)} | Generated ${htmlEscape(format(new Date(), 'MMM d, yyyy h:mm a'))}</div>
          <div class="summary">
            <div class="box"><div class="label">Income</div><div class="value">${formatCurrency(totalIncome)}</div></div>
            <div class="box"><div class="label">Expenses</div><div class="value">${formatCurrency(totalExpense)}</div></div>
            <div class="box"><div class="label">Net</div><div class="value">${formatCurrency(net)}</div></div>
          </div>
          <h2>Spending By Category</h2>
          <table><thead><tr><th>Category</th><th>Amount</th><th>Percent</th></tr></thead><tbody>${categoryRows}</tbody></table>
          <h2>Transactions</h2>
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Account</th><th>Description</th><th>Amount</th></tr></thead>
            <tbody>${transactionRows}</tbody>
          </table>
        </body>
      </html>
    `;
  }, [categoryTotals, net, rangeLabel, reportTitle, totalExpense, totalIncome, transactions]);

  const exportCsv = useCallback(async () => {
    setExporting('csv');
    try {
      const filename = `${safeFilePart(reportTitle)}-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`;
      const uri = await writeTextFile(filename, buildCsv(), 'text/csv;charset=utf-8');
      if (uri) await shareFile(uri, 'text/csv');
      showToast({ type: 'success', text1: 'CSV exported', text2: Platform.OS === 'web' ? filename : 'Choose where to save or share it.' });
    } catch (error) {
      showToast({ type: 'error', text1: 'CSV export failed', text2: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setExporting(null);
    }
  }, [buildCsv, reportTitle]);

  const exportPdf = useCallback(async (shareAfterCreate = false) => {
    setExporting(shareAfterCreate ? 'share' : 'pdf');
    try {
      const filename = `${safeFilePart(reportTitle)}-${format(new Date(), 'yyyyMMdd-HHmm')}.pdf`;
      const html = buildPdfHtml();

      if (Platform.OS === 'web') {
        printWebHtml(html);
        showToast({ type: 'success', text1: shareAfterCreate ? 'Report opened' : 'PDF export opened', text2: 'Use the browser print dialog to save as PDF.' });
        return;
      }

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await shareFile(uri, 'application/pdf');
      showToast({ type: 'success', text1: shareAfterCreate ? 'Report ready to share' : 'PDF generated', text2: filename });
    } catch (error) {
      showToast({ type: 'error', text1: shareAfterCreate ? 'Share failed' : 'PDF export failed', text2: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setExporting(null);
    }
  }, [buildPdfHtml, reportTitle]);

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadReports} tintColor="#E94560" colors={["#E94560"]} />}
      >
        <View style={styles.exportRow}>
          <ExportButton icon="download" label="CSV" loading={exporting === 'csv'} disabled={loading || Boolean(exporting)} onPress={exportCsv} />
          <ExportButton icon="file-text" label="PDF" loading={exporting === 'pdf'} disabled={loading || Boolean(exporting)} onPress={() => exportPdf(false)} />
          <ExportButton icon="share-2" label="Share" loading={exporting === 'share'} disabled={loading || Boolean(exporting)} onPress={() => exportPdf(true)} />
        </View>

        <View style={styles.periodRow}>
          {(['week', 'month', 'quarter', 'year', 'custom'] as Period[]).map((item) => (
            <TouchableOpacity key={item} style={[styles.periodPill, period === item && styles.periodPillActive]} onPress={() => setPeriod(item)}>
              <Text style={[styles.periodText, period === item && styles.periodTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={18} color="#E74C3C" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <ReportSection title="Spending Overview">
          {loading ? <ChartSkeleton /> : transactions.length ? (
            <LineChart
              data={lineChartData}
              width={width}
              height={230}
              fromZero
              bezier
              withInnerLines={false}
              chartConfig={{
                backgroundColor: '#FFFFFF',
                backgroundGradientFrom: '#FFFFFF',
                backgroundGradientTo: '#FFFFFF',
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(26, 26, 46, ${opacity})`,
                labelColor: () => '#6C757D',
                propsForDots: { r: '3' },
              }}
              style={styles.chartKit}
            />
          ) : <EmptyChart icon="activity" text="No transactions for this period." />}
        </ReportSection>

        <ReportSection title="Spending by Category">
          <SpendingDonutChart data={categoryTotals.map(({ label, value, color }) => ({ label, value, color }))} loading={loading} />
          <View style={styles.legendList}>
            {categoryTotals.map((item) => (
              <View key={item.label} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                <Text style={styles.legendName}>{item.label}</Text>
                <Text style={styles.legendAmount}>{formatCurrency(item.value)} | {item.percent.toFixed(0)}%</Text>
              </View>
            ))}
          </View>
        </ReportSection>

        <ReportSection title="Income vs Expenses">
          <IncomeExpenseBarChart data={barData} loading={loading} />
        </ReportSection>

        <ReportSection title="Top Spending Categories">
          {categoryTotals.length ? categoryTotals.slice(0, 5).map((item, index) => (
            <View key={item.label} style={styles.rankRow}>
              <View style={[styles.rankBadge, { backgroundColor: item.color }]}><Text style={styles.rankText}>{index + 1}</Text></View>
              <View style={styles.rankCenter}>
                <Text style={styles.rankName}>{item.label}</Text>
                <View style={styles.rankTrack}><View style={[styles.rankFill, { width: `${item.percent}%`, backgroundColor: item.color }]} /></View>
              </View>
              <Text style={styles.rankAmount}>{formatCurrency(item.value)}
                <Text style={styles.rankPercent}> {item.percent.toFixed(0)}%</Text>
              </Text>
            </View>
          )) : <EmptyChart icon="bar-chart-2" text="No category spending yet." />}
        </ReportSection>

        <ReportSection title="Monthly Trend">
          <TrendLineChart data={trendTransactions.length ? trendData : []} loading={loading} />
        </ReportSection>
      </ScrollView>
    </View>
  );
}

function ExportButton({ icon, label, loading, disabled, onPress }: { icon: FeatherIconName; label: string; loading: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.exportButton, disabled && styles.exportButtonDisabled]} onPress={onPress} disabled={disabled} activeOpacity={0.78}>
      {loading ? <ActivityIndicator color="#E94560" /> : <Feather name={icon} size={18} color="#E94560" />}
      <Text style={styles.exportText}>{label}</Text>
    </TouchableOpacity>
  );
}

function buildDailyOverview(transactions: Transaction[], period: Period) {
  const range = rangeFor(period);
  if (period === 'year' || period === 'quarter') {
    const monthCount = period === 'year' ? 12 : 3;
    const months = Array.from({ length: monthCount }, (_, index) => utcMonthStart(range.start, index));
    return {
      labels: months.map(utcMonthLabel),
      income: months.map((month) => {
        const key = utcMonthKey(month);
        return transactions
          .filter((transaction) => utcMonthKey(parseStoredDate(transaction.date)) === key && transaction.type === 'income')
          .reduce((sum, transaction) => sum + transaction.amount, 0);
      }),
      expense: months.map((month) => {
        const key = utcMonthKey(month);
        return transactions
          .filter((transaction) => utcMonthKey(parseStoredDate(transaction.date)) === key && transaction.type === 'expense')
          .reduce((sum, transaction) => sum + transaction.amount, 0);
      }),
    };
  }

  const days = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000) + 1);
  const labels: string[] = [];
  const income: number[] = [];
  const expense: number[] = [];

  for (let i = 0; i < days; i += 1) {
    const day = addUtcDays(range.start, i);
    const key = dateKey(day);
    const dayTransactions = transactions.filter((transaction) => dateKey(parseStoredDate(transaction.date)) === key);
    labels.push(days > 31 ? formatUtcDayLabel(day, 'monthDay') : formatUtcDayLabel(day, 'day'));
    income.push(dayTransactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0));
    expense.push(dayTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0));
  }

  return { labels, income, expense };
}

function buildCategoryTotals(transactions: Transaction[]): CategoryTotal[] {
  const totals = new Map<string, number>();
  transactions.filter((item) => item.type === 'expense').forEach((transaction) => {
    const label = getCategory(transaction);
    totals.set(label, (totals.get(label) || 0) + transaction.amount);
  });
  const total = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
  return Array.from(totals.entries())
    .map(([label, value], index) => ({ label, value, color: colors[index % colors.length] || '#0F3460', percent: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

function buildBarData(transactions: Transaction[], period: Period): BarDatum[] {
  const buckets = new Map<string, { income: number; expense: number }>();
  transactions.forEach((transaction) => {
    const date = parseStoredDate(transaction.date);
    const label = period === 'year' ? utcMonthLabel(date) : `W${Math.ceil(date.getUTCDate() / 7)}`;
    const current = buckets.get(label) || { income: 0, expense: 0 };
    if (transaction.type === 'income') current.income += transaction.amount;
    if (transaction.type === 'expense') current.expense += transaction.amount;
    buckets.set(label, current);
  });
  return Array.from(buckets.entries()).map(([label, values]) => ({ label, ...values }));
}

function buildTrendData(transactions: Transaction[]): TrendDatum[] {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => utcMonthStart(now, -(5 - index)));
  return months.map((month) => {
    const label = utcMonthLabel(month);
    const key = utcMonthKey(month);
    const value = transactions
      .filter((transaction) => utcMonthKey(parseStoredDate(transaction.date)) === key)
      .reduce((sum, transaction) => sum + (transaction.type === 'income' ? transaction.amount : transaction.type === 'expense' ? -transaction.amount : 0), 0);
    return { label, value };
  });
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function ChartSkeleton() {
  return <View style={styles.skeleton}><ActivityIndicator color="#E94560" /></View>;
}

function EmptyChart({ icon, text }: { icon: FeatherIconName; text: string }) {
  return (
    <View style={styles.emptyChart}>
      <Feather name={icon} size={30} color="#ADB5BD" />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 36 },
  exportRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  exportButton: { flex: 1, height: 44, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E9456033', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  exportButtonDisabled: { opacity: 0.55 },
  exportText: { color: '#E94560', fontSize: 13, fontWeight: '900' },
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  periodPill: { flex: 1, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DEE2E6' },
  periodPillActive: { backgroundColor: '#E94560', borderColor: '#E94560' },
  periodText: { color: '#6C757D', fontSize: 12, fontWeight: '900', textTransform: 'capitalize' },
  periodTextActive: { color: '#FFFFFF' },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#FDECEC', padding: 12, marginBottom: 18 },
  errorText: { color: '#E74C3C', fontSize: 13, fontWeight: '800', flex: 1 },
  section: { marginBottom: 22 },
  sectionTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900', marginBottom: 12 },
  card: { borderRadius: 18, backgroundColor: '#FFFFFF', padding: 16, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3, overflow: 'hidden' },
  chartKit: { borderRadius: 16, marginLeft: -12 },
  skeleton: { height: 220, borderRadius: 18, backgroundColor: '#E9ECEF', alignItems: 'center', justifyContent: 'center' },
  emptyChart: { minHeight: 170, borderRadius: 18, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyText: { color: '#6C757D', fontSize: 13, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  legendList: { marginTop: 16, gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 9 },
  legendName: { color: '#1A1A2E', fontSize: 14, fontWeight: '800', flex: 1 },
  legendAmount: { color: '#6C757D', fontSize: 13, fontWeight: '800' },
  rankRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  rankBadge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rankText: { color: '#FFFFFF', fontWeight: '900' },
  rankCenter: { flex: 1, minWidth: 0 },
  rankName: { color: '#1A1A2E', fontSize: 14, fontWeight: '900', marginBottom: 8 },
  rankTrack: { height: 8, borderRadius: 999, backgroundColor: '#EEF0F2', overflow: 'hidden' },
  rankFill: { height: 8, borderRadius: 999 },
  rankAmount: { color: '#1A1A2E', fontSize: 13, fontWeight: '900', marginLeft: 10, textAlign: 'right' },
  rankPercent: { color: '#6C757D', fontSize: 12 },
});

