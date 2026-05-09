import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { format } from 'date-fns';
import { StackScreenProps } from '@react-navigation/stack';
import { TransactionListItem } from '../../components/common/TransactionListItem';
import { showToast } from '../../components/common/Toast';
import { BudgetsStackParamList } from '../../navigation';
import api from '../../services/api';
import { Budget, Transaction } from '../../store';
import { featherIconName } from '../../utils/icons';
import { ListPayload, unwrapList } from '../../types/api';

type Props = StackScreenProps<BudgetsStackParamList, 'BudgetDetail'>;
type Category = { id: string; name: string; icon?: string; color?: string };
type BudgetDetail = Budget & {
  weekly_breakdown?: Array<{ week: string; spending: number }>;
};
type TransactionsResponse = {
  data: Transaction[];
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
}

function safeDate(value?: string | null) {
  if (!value) return 'Open ended';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Open ended' : format(parsed, 'MMM d, yyyy');
}

function progressColor(ratio: number) {
  if (ratio >= 1) return '#E74C3C';
  if (ratio >= 0.75) return '#F39C12';
  return '#27AE60';
}

export default function BudgetDetailScreen({ route }: Props) {
  const { id } = route.params;
  const [budget, setBudget] = useState<BudgetDetail | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [category, setCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadBudget = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const budgetResponse = await api.get<BudgetDetail>(`/api/budgets/${id}`);
      const nextBudget = budgetResponse.data;

      const params = {
        category_id: nextBudget.category_id,
        type: 'expense',
        start_date: nextBudget.start_date,
        end_date: nextBudget.end_date || undefined,
        limit: 100,
        page: 1,
      };

      const [transactionsResponse, categoriesResponse] = await Promise.all([
        api.get<TransactionsResponse>('/api/transactions', { params }),
        api.get<ListPayload<Category>>('/api/categories', { params: { page: 1, limit: 200 } }),
      ]);

      setBudget(nextBudget);
      setTransactions(transactionsResponse.data.data);
      setCategory(unwrapList(categoriesResponse.data).find((item) => item.id === nextBudget.category_id) || null);
    } catch {
      showToast({ type: 'error', text1: 'Budget failed to load', text2: 'Please try again.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  const amount = Number(budget?.amount || 0);
  const spent = Number(budget?.current_spending || 0);
  const remaining = Number(budget?.remaining ?? amount - spent);
  const ratio = (Number.isFinite(spent) && Number.isFinite(amount) && amount > 0) ? spent / amount : 0;
  const color = category?.color || budget?.category_color || progressColor(ratio);
  const icon = featherIconName(category?.icon || budget?.category_icon, 'pie-chart');
  const categoryName = category?.name || budget?.category_name || 'Budget';
  const maxWeekly = useMemo(
    () => Math.max(1, ...(budget?.weekly_breakdown || []).map((item) => Number(item.spending || 0))),
    [budget?.weekly_breakdown]
  );

  if (loading && !budget) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#E94560" />
      </View>
    );
  }

  if (!budget) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Budget unavailable</Text>
        <Text style={styles.emptyText}>Pull to refresh and try again.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadBudget(true)} tintColor="#E94560" colors={['#E94560']} />}
    >
      <View style={styles.headerCard}>
        <View style={[styles.iconCircle, { backgroundColor: `${color}18` }]}>
          <Feather name={icon} size={28} color={color} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.categoryName}>{categoryName}</Text>
          <Text style={styles.dateRange}>{safeDate(budget.start_date)} - {safeDate(budget.end_date)}</Text>
        </View>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.amountRow}>
          <View>
            <Text style={styles.label}>Budgeted</Text>
            <Text style={styles.amount}>{formatCurrency(amount)}</Text>
          </View>
          <View style={styles.amountRight}>
            <Text style={styles.label}>Spent</Text>
            <Text style={[styles.amount, { color }]}>{formatCurrency(spent)}</Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(Math.max(ratio, 0), 1) * 100}%`, backgroundColor: color }]} />
        </View>

        <Text style={[styles.remainingText, { color: remaining >= 0 ? '#27AE60' : '#E74C3C' }]}>
          {remaining >= 0
            ? `${formatCurrency(remaining)} remaining`
            : `Over by ${formatCurrency(Math.abs(remaining))}`}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Weekly Breakdown</Text>
      <View style={styles.breakdownCard}>
        {budget.weekly_breakdown?.length ? (
          budget.weekly_breakdown.map((item) => (
            <View key={item.week} style={styles.weekRow}>
              <Text style={styles.weekLabel}>{item.week}</Text>
              <View style={styles.weekTrack}>
                <View style={[styles.weekFill, { width: `${(Number(item.spending || 0) / maxWeekly) * 100}%`, backgroundColor: color }]} />
              </View>
              <Text style={styles.weekAmount}>{formatCurrency(Number(item.spending || 0))}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>No spending recorded in this budget period.</Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Transactions</Text>
      {transactions.length ? (
        transactions.map((transaction) => <TransactionListItem key={transaction.id} transaction={transaction} />)
      ) : (
        <View style={styles.emptyCard}>
          <Feather name="file-text" size={26} color="#ADB5BD" />
          <Text style={styles.emptyText}>No transactions match this budget yet.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 36 },
  centered: { flex: 1, backgroundColor: '#F8F9FA', alignItems: 'center', justifyContent: 'center', padding: 24 },
  headerCard: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  iconCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  headerText: { flex: 1, minWidth: 0 },
  categoryName: { color: '#1A1A2E', fontSize: 22, fontWeight: '900' },
  dateRange: { color: '#6C757D', fontSize: 13, fontWeight: '700', marginTop: 6 },
  summaryCard: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 18, marginBottom: 22 },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  amountRight: { alignItems: 'flex-end' },
  label: { color: '#6C757D', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  amount: { color: '#1A1A2E', fontSize: 28, fontWeight: '900', marginTop: 6 },
  progressTrack: { height: 10, borderRadius: 999, backgroundColor: '#EEF0F2', overflow: 'hidden' },
  progressFill: { height: 10, borderRadius: 999 },
  remainingText: { fontSize: 15, fontWeight: '900', marginTop: 14 },
  sectionTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900', marginBottom: 12 },
  breakdownCard: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 16, marginBottom: 22 },
  weekRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  weekLabel: { width: 78, color: '#6C757D', fontSize: 12, fontWeight: '800' },
  weekTrack: { flex: 1, height: 8, borderRadius: 999, backgroundColor: '#EEF0F2', overflow: 'hidden' },
  weekFill: { height: 8, borderRadius: 999 },
  weekAmount: { width: 64, color: '#1A1A2E', fontSize: 12, fontWeight: '900', textAlign: 'right' },
  emptyCard: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 24, alignItems: 'center' },
  emptyTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900' },
  emptyText: { color: '#6C757D', fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 8 },
});
