import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import { DashboardStackParamList } from '../../navigation';
import api from '../../services/api';
import { fetchAccounts, type Account } from '../../store/slices/accountsSlice';
import { fetchBudgets, type Budget } from '../../store/slices/budgetsSlice';
import { type Transaction } from '../../store/slices/transactionsSlice';
import { useAppDispatch } from '../../store/hooks';
import { useTheme } from '../../theme';
import {
  accountBalance as accountBalanceValue,
  formatAccountBalanceSummary,
  groupAccountBalancesByCurrency,
  hasMixedCurrencies,
} from '../../utils/accountBalances';
import { formatCurrency, formatDate } from '../../utils/formatters';
import type { FeatherIconName } from '../../utils/icons';

type Props = StackScreenProps<DashboardStackParamList, 'Overview'>;

type OverviewRange = 'month' | 'quarter' | 'year' | 'all';

type Summary = {
  total_income: number;
  total_expense: number;
  net: number;
  grouped_by_category?: Array<{
    category_id?: string | null;
    category_name?: string;
    type?: 'income' | 'expense' | 'transfer';
    total?: number;
  }>;
};

type TransactionsResponse = {
  data: Transaction[];
};

type OverviewData = {
  accounts: Account[];
  budgets: Budget[];
  summary: Summary;
  transactions: Transaction[];
};

const rangeOptions: Array<{ key: OverviewRange; label: string }> = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All' },
];

function periodRange(range: OverviewRange) {
  if (range === 'all') return {};

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

  if (range === 'quarter') {
    start.setUTCMonth(start.getUTCMonth() - 2);
  }

  if (range === 'year') {
    start.setUTCMonth(0);
  }

  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start_date: start.toISOString(), end_date: end.toISOString() };
}

function amountValue(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function accountTypeLabel(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function transactionAmount(transaction: Transaction) {
  const amount = amountValue(transaction.amount);
  if (transaction.type === 'expense') return -amount;
  if (transaction.type === 'transfer' && transaction.transfer_direction === 'source') return -amount;
  return amount;
}

function expenseGroups(summary: Summary) {
  return (summary.grouped_by_category || [])
    .filter((item) => item.type === 'expense')
    .map((item) => ({
      id: item.category_id || item.category_name || 'uncategorized',
      name: item.category_name || 'Uncategorized',
      amount: amountValue(item.total),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
}

export default function OverviewScreen({ navigation }: Props) {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const rootNav = useNavigation<any>();
  const [range, setRange] = useState<OverviewRange>('month');
  const [data, setData] = useState<OverviewData>({
    accounts: [],
    budgets: [],
    summary: { total_income: 0, total_expense: 0, net: 0, grouped_by_category: [] },
    transactions: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadOverview = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const params = periodRange(range);
      const [accounts, budgets, summaryResponse, transactionsResponse] = await Promise.all([
        dispatch(fetchAccounts()).unwrap(),
        dispatch(fetchBudgets()).unwrap(),
        api.get<Summary>('/api/transactions/summary', { params }),
        api.get<TransactionsResponse>('/api/transactions', { params: { ...params, page: 1, limit: 100 } }),
      ]);

      setData({
        accounts,
        budgets,
        summary: summaryResponse.data,
        transactions: transactionsResponse.data.data || [],
      });
    } catch {
      showToast({ type: 'error', text1: 'Overview refresh failed', text2: 'Please check your connection and try again.' });
    } finally {
      setLoading(false);
      if (showRefresh) setRefreshing(false);
    }
  }, [dispatch, range]);

  useFocusEffect(
    useCallback(() => {
      loadOverview();
    }, [loadOverview])
  );

  const overview = useMemo(() => {
    const assetGroups = groupAccountBalancesByCurrency(data.accounts.filter((account) => account.type !== 'credit'));
    const creditGroups = groupAccountBalancesByCurrency(data.accounts
      .filter((account) => account.type === 'credit')
      .map((account) => ({ ...account, current_balance: Math.abs(accountBalanceValue(account)) })));
    const netWorthGroups = groupAccountBalancesByCurrency(data.accounts);
    const savingsRate = data.summary.total_income > 0 ? (data.summary.net / data.summary.total_income) * 100 : 0;
    const largestExpense = expenseGroups(data.summary)[0];
    const budgetLimit = data.budgets.reduce((sum, budget) => sum + amountValue(budget.amount), 0);
    const budgetSpent = data.budgets.reduce((sum, budget) => sum + amountValue(budget.current_spending), 0);
    const budgetUsed = budgetLimit > 0 ? budgetSpent / budgetLimit : 0;
    const overBudgetCount = data.budgets.filter((budget) => amountValue(budget.current_spending) > amountValue(budget.amount)).length;
    const activeBudgets = data.budgets.filter((budget) => !budget.end_date || new Date(budget.end_date) >= new Date()).length;

    return {
      assetGroups,
      creditGroups,
      netWorthGroups,
      savingsRate,
      largestExpense,
      budgetLimit,
      budgetSpent,
      budgetUsed,
      overBudgetCount,
      activeBudgets,
      expenseCategories: expenseGroups(data.summary),
      cashflowAverage: data.transactions.length ? data.summary.net / data.transactions.length : 0,
    };
  }, [data]);

  const netWorthDisplay = formatAccountBalanceSummary(overview.netWorthGroups, { maximumFractionDigits: 0 });
  const creditUsedDisplay = formatAccountBalanceSummary(overview.creditGroups, { maximumFractionDigits: 0 });
  const mixedNetWorthCurrencies = hasMixedCurrencies(overview.netWorthGroups);

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator size="large" color={theme.colors.highlight} />
        <Text style={styles.loadingText}>Loading overview</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadOverview(true)} tintColor={theme.colors.highlight} colors={[theme.colors.highlight]} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>Financial Overview</Text>
            <Text style={styles.title}>A deeper look at your money</Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Close overview">
            <Feather name="x" size={20} color="#1A1A2E" />
          </TouchableOpacity>
        </View>

        <View style={styles.rangeRow}>
          {rangeOptions.map((option) => {
            const active = range === option.key;
            return (
              <TouchableOpacity
                key={option.key}
                style={[styles.rangeButton, active && styles.rangeButtonActive]}
                onPress={() => setRange(option.key)}
                activeOpacity={0.82}
              >
                <Text style={[styles.rangeText, active && styles.rangeTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Net worth</Text>
          <Text style={styles.heroValue}>{netWorthDisplay}</Text>
          {mixedNetWorthCurrencies ? <Text style={styles.heroNote}>Multiple currencies shown separately</Text> : null}
          <View style={styles.heroMetrics}>
            <HeroMetric label="Income" value={formatCurrency(data.summary.total_income)} color={theme.colors.success} />
            <HeroMetric label="Expenses" value={formatCurrency(data.summary.total_expense)} color={theme.colors.danger} />
            <HeroMetric label="Net" value={formatCurrency(data.summary.net)} color={data.summary.net >= 0 ? theme.colors.success : theme.colors.danger} />
          </View>
        </View>

        <View style={styles.insightGrid}>
          <InsightCard icon="trending-up" label="Savings rate" value={`${overview.savingsRate.toFixed(1)}%`} tone={overview.savingsRate >= 0 ? theme.colors.success : theme.colors.danger} />
          <InsightCard icon="credit-card" label="Credit used" value={creditUsedDisplay} tone={theme.colors.warning} />
          <InsightCard icon="pie-chart" label="Budget used" value={`${(overview.budgetUsed * 100).toFixed(1)}%`} tone={theme.colors.accent} />
          <InsightCard icon="activity" label="Avg. movement" value={formatCurrency(overview.cashflowAverage)} tone={theme.colors.highlight} />
        </View>

        <Section title="Account Breakdown" action="Manage" onPress={() => rootNav.navigate('Accounts')}>
          {data.accounts.length === 0 ? (
            <EmptyPanel icon="credit-card" title="No accounts yet" />
          ) : (
            data.accounts.map((account) => (
              <MetricRow
                key={account.id}
                icon={(account.icon as FeatherIconName) || 'credit-card'}
                label={account.name}
                detail={accountTypeLabel(account.type)}
                value={formatCurrency(accountBalanceValue(account), account.currency)}
                color={account.color || theme.colors.accent}
                onPress={() => rootNav.navigate('Accounts', { screen: 'AccountDetail', params: { id: account.id } })}
              />
            ))
          )}
        </Section>

        <Section title="Spending Detail" action="Reports" onPress={() => rootNav.navigate('Reports')}>
          {overview.expenseCategories.length === 0 ? (
            <EmptyPanel icon="bar-chart-2" title="No spending in this period" />
          ) : (
            overview.expenseCategories.map((category) => (
              <ProgressRow
                key={category.id}
                label={category.name}
                value={formatCurrency(category.amount)}
                percent={data.summary.total_expense ? category.amount / data.summary.total_expense : 0}
                color={theme.colors.highlight}
              />
            ))
          )}
        </Section>

        <Section title="Budget Health" action="Budgets" onPress={() => rootNav.navigate('Budgets')}>
          <View style={styles.budgetSummary}>
            <SummaryPill icon="check-circle" label="Active" value={`${overview.activeBudgets}`} color={theme.colors.success} />
            <SummaryPill icon="alert-triangle" label="Over budget" value={`${overview.overBudgetCount}`} color={theme.colors.danger} />
            <SummaryPill icon="target" label="Remaining" value={formatCurrency(overview.budgetLimit - overview.budgetSpent)} color={theme.colors.accent} />
          </View>
          {data.budgets.slice(0, 4).map((budget) => (
            <ProgressRow
              key={budget.id}
              label={budget.category_name || 'Budget'}
              value={`${formatCurrency(amountValue(budget.current_spending))} / ${formatCurrency(amountValue(budget.amount))}`}
              percent={amountValue(budget.amount) ? amountValue(budget.current_spending) / amountValue(budget.amount) : 0}
              color={amountValue(budget.current_spending) > amountValue(budget.amount) ? theme.colors.danger : theme.colors.success}
            />
          ))}
        </Section>

        <Section title="Recent Activity" action="Transactions" onPress={() => rootNav.navigate('Transactions')}>
          {data.transactions.slice(0, 6).map((transaction) => (
            <MetricRow
              key={transaction.id}
              icon={transaction.type === 'income' ? 'arrow-down-left' : transaction.type === 'expense' ? 'arrow-up-right' : 'repeat'}
              label={transaction.description || transaction.category_name || 'Transaction'}
              detail={`${transaction.account_name || 'Account'} • ${formatDate(transaction.date)}`}
              value={formatCurrency(transactionAmount(transaction))}
              color={transactionAmount(transaction) >= 0 ? theme.colors.success : theme.colors.danger}
              onPress={() => rootNav.navigate('Transactions', { screen: 'TransactionDetail', params: { id: transaction.id } })}
            />
          ))}
          {data.transactions.length === 0 ? <EmptyPanel icon="list" title="No transactions in this period" /> : null}
        </Section>
      </ScrollView>
    </View>
  );
}

function HeroMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.heroMetric}>
      <Text style={styles.heroMetricLabel}>{label}</Text>
      <Text style={[styles.heroMetricValue, { color }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function InsightCard({ icon, label, value, tone }: { icon: FeatherIconName; label: string; value: string; tone: string }) {
  return (
    <View style={styles.insightCard}>
      <View style={[styles.insightIcon, { backgroundColor: `${tone}16` }]}>
        <Feather name={icon} size={19} color={tone} />
      </View>
      <Text style={styles.insightLabel}>{label}</Text>
      <Text style={styles.insightValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Section({ title, action, onPress, children }: { title: string; action?: string; onPress?: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action ? (
          <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
            <Text style={styles.sectionAction}>{action}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function MetricRow({ icon, label, detail, value, color, onPress }: {
  icon: FeatherIconName;
  label: string;
  detail: string;
  value: string;
  color: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity style={styles.metricRow} onPress={onPress} activeOpacity={onPress ? 0.78 : 1}>
      <View style={[styles.rowIcon, { backgroundColor: `${color}16` }]}>
        <Feather name={icon} size={18} color={color} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text>
      </View>
      <Text style={[styles.rowValue, { color }]} numberOfLines={1}>{value}</Text>
    </TouchableOpacity>
  );
}

function ProgressRow({ label, value, percent, color }: { label: string; value: string; percent: number; color: string }) {
  const clamped = Math.max(0, Math.min(percent, 1));
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressTextRow}>
        <Text style={styles.progressLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.progressValue} numberOfLines={1}>{value}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function SummaryPill({ icon, label, value, color }: { icon: FeatherIconName; label: string; value: string; color: string }) {
  return (
    <View style={styles.summaryPill}>
      <Feather name={icon} size={16} color={color} />
      <View style={styles.summaryPillCopy}>
        <Text style={styles.summaryPillValue} numberOfLines={1}>{value}</Text>
        <Text style={styles.summaryPillLabel} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

function EmptyPanel({ icon, title }: { icon: FeatherIconName; title: string }) {
  return (
    <View style={styles.emptyPanel}>
      <Feather name={icon} size={24} color="#ADB5BD" />
      <Text style={styles.emptyText}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  loadingRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FA' },
  loadingText: { color: '#6C757D', fontSize: 14, fontWeight: '800', marginTop: 12 },
  scrollContent: { padding: 20, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  headerText: { flex: 1, paddingRight: 12 },
  eyebrow: { color: '#E94560', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  title: { color: '#1A1A2E', fontSize: 27, fontWeight: '900', marginTop: 5, letterSpacing: 0 },
  closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  rangeRow: { flexDirection: 'row', backgroundColor: '#EDEFF2', borderRadius: 12, padding: 4, marginBottom: 16 },
  rangeButton: { flex: 1, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rangeButtonActive: { backgroundColor: '#FFFFFF' },
  rangeText: { color: '#6C757D', fontSize: 13, fontWeight: '900' },
  rangeTextActive: { color: '#1A1A2E' },
  heroCard: { backgroundColor: '#1A1A2E', borderRadius: 18, padding: 20, marginBottom: 16 },
  heroLabel: { color: '#ADB5BD', fontSize: 13, fontWeight: '800' },
  heroValue: { color: '#FFFFFF', fontSize: 31, lineHeight: 39, fontWeight: '900', marginTop: 7, letterSpacing: 0 },
  heroNote: { color: '#ADB5BD', fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 7 },
  heroMetrics: { flexDirection: 'row', gap: 10, marginTop: 18 },
  heroMetric: { flex: 1, minWidth: 0 },
  heroMetricLabel: { color: '#ADB5BD', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  heroMetricValue: { fontSize: 15, fontWeight: '900', marginTop: 5 },
  insightGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  insightCard: { width: '48%', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14 },
  insightIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  insightLabel: { color: '#6C757D', fontSize: 12, fontWeight: '800' },
  insightValue: { color: '#1A1A2E', fontSize: 20, fontWeight: '900', marginTop: 4, letterSpacing: 0 },
  section: { marginTop: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900', letterSpacing: 0 },
  sectionAction: { color: '#E94560', fontSize: 13, fontWeight: '900' },
  metricRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 13, marginBottom: 10 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { color: '#1A1A2E', fontSize: 14, fontWeight: '900' },
  rowDetail: { color: '#6C757D', fontSize: 12, fontWeight: '700', marginTop: 3 },
  rowValue: { maxWidth: 130, fontSize: 14, fontWeight: '900', marginLeft: 10 },
  progressRow: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 10 },
  progressTextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  progressLabel: { flex: 1, color: '#1A1A2E', fontSize: 14, fontWeight: '900', marginRight: 10 },
  progressValue: { color: '#6C757D', fontSize: 12, fontWeight: '900', maxWidth: 155 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: '#EDEFF2', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  budgetSummary: { flexDirection: 'row', gap: 9, marginBottom: 10 },
  summaryPill: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 10 },
  summaryPillCopy: { flex: 1, minWidth: 0, marginLeft: 7 },
  summaryPillValue: { color: '#1A1A2E', fontSize: 14, fontWeight: '900' },
  summaryPillLabel: { color: '#6C757D', fontSize: 10, fontWeight: '800', marginTop: 2 },
  emptyPanel: { backgroundColor: '#FFFFFF', borderRadius: 14, alignItems: 'center', padding: 20 },
  emptyText: { color: '#6C757D', fontSize: 14, fontWeight: '800', marginTop: 8, textAlign: 'center' },
});
