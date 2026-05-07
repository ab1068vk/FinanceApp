import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Modal from 'react-native-modal';
import Svg, { Circle } from 'react-native-svg';
import Feather from '@expo/vector-icons/Feather';
import { addMonths, endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import { DatePickerField } from '../../components/common/DatePickerField';
import api from '../../services/api';
import { Budget, createBudget as createBudgetThunk, fetchBudgets } from '../../store';
import { BudgetsStackParamList } from '../../navigation';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { useTheme } from '../../theme';
import { featherIconName } from '../../utils/icons';
import { ListPayload, unwrapList } from '../../types/api';
import { parsePositiveMoney, sanitizeDecimalInput } from '../../utils/numberInput';

type Category = { id: string; name: string; icon?: string; color?: string; type?: 'income' | 'expense' };
type Period = 'monthly' | 'weekly' | 'yearly';
type DailyBreakdown = { label: string; total: number };
type Props = StackScreenProps<BudgetsStackParamList, 'BudgetsHome'>;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
}

function monthRange(month: Date) {
  return { start: startOfMonth(month), end: endOfMonth(month) };
}

function parseBudgetDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isBudgetActiveForRange(budget: Budget, viewStart: Date, viewEnd: Date) {
  const budgetStart = parseBudgetDate(budget.start_date);
  const budgetEnd = parseBudgetDate(budget.end_date);
  return (!budgetStart || budgetStart <= viewEnd) && (!budgetEnd || budgetEnd >= viewStart);
}

function budgetPeriodNote(budget: Budget, viewStart: Date, viewEnd: Date) {
  const budgetStart = parseBudgetDate(budget.start_date);
  const budgetEnd = parseBudgetDate(budget.end_date);
  const parts: string[] = [];

  if (budgetStart && budgetStart > viewStart) parts.push(`Starts ${format(budgetStart, 'MMM d')}`);
  if (budgetStart && budgetStart < viewStart) parts.push(`Started before ${format(viewStart, 'MMM')}`);
  if (budgetEnd && budgetEnd < viewEnd) parts.push(`Ends ${format(budgetEnd, 'MMM d')}`);
  if (!budgetEnd || budgetEnd > viewEnd) parts.push(`Continues after ${format(viewEnd, 'MMM')}`);

  return parts.join(' | ');
}

function progressColor(ratio: number) {
  if (ratio >= 0.9) return '#E74C3C';
  if (ratio >= 0.75) return '#F39C12';
  return '#27AE60';
}

export default function BudgetsScreen({ navigation }: Props) {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const budgets = useAppSelector((state) => state.budgets.budgets);
  const isLoading = useAppSelector((state) => state.budgets.isLoading);
  const error = useAppSelector((state) => state.budgets.error);
  const [month, setMonth] = useState(new Date());
  const [modalVisible, setModalVisible] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<Period>('monthly');
  const [startDate, setStartDate] = useState(startOfMonth(new Date()).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(endOfMonth(new Date()).toISOString().slice(0, 10));
  const [expandedBudgetId, setExpandedBudgetId] = useState<string | null>(null);
  const [breakdowns, setBreakdowns] = useState<Record<string, DailyBreakdown[]>>({});

  const { start, end } = useMemo(() => monthRange(month), [month]);
  const activeBudgets = useMemo(() => budgets.filter((budget) => isBudgetActiveForRange(budget, start, end)), [budgets, start, end]);
  const hiddenBudgetCount = budgets.length - activeBudgets.length;

  const loadBudgets = useCallback(async () => {
    try {
      const [, categoryResponse] = await Promise.all([
        dispatch(fetchBudgets()).unwrap(),
        api.get<ListPayload<Category>>('/api/categories', { params: { page: 1, limit: 200 } }),
      ]);
      setCategories(unwrapList(categoryResponse.data).filter((category) => category.type !== 'income'));
    } catch (error) {
      showToast({ type: 'error', text1: 'Budgets failed to load' });
    }
  }, [dispatch]);

  useFocusEffect(
    useCallback(() => {
      loadBudgets();
    }, [loadBudgets]),
  );

  useEffect(() => {
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  }, [start, end]);

  const totalBudgeted = activeBudgets.reduce((sum, budget) => sum + Number(budget.amount || 0), 0);
  const totalSpent = activeBudgets.reduce((sum, budget) => sum + Number(budget.current_spending || 0), 0);
  const remaining = totalBudgeted - totalSpent;
  const totalRatio = totalBudgeted > 0 ? totalSpent / totalBudgeted : 0;

  const toggleBudget = async (budget: Budget) => {
    if (expandedBudgetId === budget.id) {
      setExpandedBudgetId(null);
      return;
    }
    setExpandedBudgetId(budget.id);
    if (breakdowns[budget.id]) return;

    try {
      const response = await api.get<{ data: Array<{ date: string; amount: number }> }>('/api/transactions', {
        params: { category_id: budget.category_id, type: 'expense', start_date: start.toISOString(), end_date: end.toISOString(), limit: 100 },
      });
      const byDay: Record<string, number> = {};
      response.data.data.forEach((transaction) => {
        const key = new Date(transaction.date).getDate().toString();
        byDay[key] = (byDay[key] || 0) + Number(transaction.amount || 0);
      });
      setBreakdowns((current) => ({
        ...current,
        [budget.id]: Array.from({ length: end.getDate() }, (_, index) => ({ label: String(index + 1), total: byDay[String(index + 1)] || 0 })),
      }));
    } catch {
      setBreakdowns((current) => ({ ...current, [budget.id]: [] }));
    }
  };

  const createBudget = async () => {
    const parsedAmount = parsePositiveMoney(amount);
    if (!selectedCategory || parsedAmount === null) {
      showToast({ type: 'error', text1: 'Missing budget details', text2: 'Choose a category and enter an amount.' });
      return;
    }

    try {
      await dispatch(createBudgetThunk({
        category_id: selectedCategory,
        amount: parsedAmount,
        period,
        start_date: new Date(startDate).toISOString(),
        end_date: endDate ? new Date(endDate).toISOString() : null,
      })).unwrap();
      showToast({ type: 'success', text1: 'Budget created' });
      setModalVisible(false);
      setSelectedCategory('');
      setAmount('');
      setPeriod('monthly');
      loadBudgets();
    } catch (error) {
      showToast({ type: 'error', text1: 'Unable to create budget' });
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.monthButton} onPress={() => setMonth((value) => subMonths(value, 1))}><Feather name="chevron-left" size={24} color="#1A1A2E" /></TouchableOpacity>
        <Text style={styles.monthTitle}>{format(month, 'MMMM yyyy')}</Text>
        <TouchableOpacity style={styles.monthButton} onPress={() => setMonth((value) => addMonths(value, 1))}><Feather name="chevron-right" size={24} color="#1A1A2E" /></TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadBudgets} tintColor="#E94560" colors={["#E94560"]} />}
      >
        <View style={[styles.summaryCard, theme.shadows.medium]}>
          <View>
            <Text style={styles.summaryLabel}>Total budgeted</Text>
            <Text style={styles.summaryTotal}>{formatCurrency(totalBudgeted)}</Text>
            <Text style={[styles.remainingText, { color: remaining >= 0 ? '#27AE60' : '#E74C3C' }]}>
              {remaining >= 0
                ? `${formatCurrency(remaining)} remaining`
                : `Over by ${formatCurrency(Math.abs(remaining))}`}
            </Text>
          </View>
          <ProgressRing spent={totalSpent} ratio={totalRatio} />
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={18} color="#E74C3C" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {isLoading ? <ActivityIndicator color="#E94560" style={styles.loader} /> : null}

        {!isLoading && hiddenBudgetCount > 0 ? (
          <View style={styles.monthFilterNotice}>
            <Feather name="calendar" size={18} color="#0F3460" />
            <Text style={styles.monthFilterText}>{hiddenBudgetCount} budget{hiddenBudgetCount === 1 ? '' : 's'} outside {format(month, 'MMMM yyyy')} hidden</Text>
          </View>
        ) : null}

        {activeBudgets.map((budget) => (
          <BudgetCard
            key={budget.id}
            budget={budget}
            expanded={expandedBudgetId === budget.id}
            breakdown={breakdowns[budget.id] || []}
            viewStart={start}
            viewEnd={end}
            onPress={() => navigation.navigate('BudgetDetail', { id: budget.id })}
          />
        ))}

        {!isLoading && activeBudgets.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="pie-chart" size={38} color="#ADB5BD" />
            <Text style={styles.emptyTitle}>{budgets.length ? 'No budgets active this month' : 'No budgets yet'}</Text>
            <Text style={styles.emptyText}>{budgets.length ? 'Use the month selector to view budgets in their active date range.' : 'Create a budget to track spending by category.'}</Text>
          </View>
        ) : null}
      </ScrollView>

      <TouchableOpacity style={[styles.fab, theme.shadows.large]} onPress={() => setModalVisible(true)}>
        <Feather name="plus" size={30} color="#FFFFFF" />
      </TouchableOpacity>

      <Modal isVisible={modalVisible} style={styles.modal} onBackdropPress={() => setModalVisible(false)} onBackButtonPress={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalSheet}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Budget</Text>
            <TouchableOpacity onPress={() => setModalVisible(false)}><Feather name="x" size={24} color="#1A1A2E" /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>Category</Text>
            <View style={styles.categoryGrid}>
              {categories.map((category) => {
                const selected = selectedCategory === category.id;
                return (
                  <TouchableOpacity key={category.id} style={[styles.categoryChoice, selected && styles.categoryChoiceActive]} onPress={() => setSelectedCategory(category.id)}>
                    <Feather name={featherIconName(category.icon, 'tag')} size={20} color={selected ? '#FFFFFF' : category.color || '#0F3460'} />
                    <Text style={[styles.categoryChoiceText, selected && styles.categoryChoiceTextActive]} numberOfLines={1}>{category.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Amount</Text>
            <TextInput value={amount} onChangeText={(value) => setAmount(sanitizeDecimalInput(value))} keyboardType="decimal-pad" placeholder="$0" style={styles.input} />

            <Text style={styles.fieldLabel}>Period</Text>
            <View style={styles.periodRow}>{(['monthly', 'weekly', 'yearly'] as Period[]).map((item) => <TouchableOpacity key={item} style={[styles.periodPill, period === item && styles.periodPillActive]} onPress={() => setPeriod(item)}><Text style={[styles.periodText, period === item && styles.periodTextActive]}>{item}</Text></TouchableOpacity>)}</View>

            <Text style={styles.fieldLabel}>Date range</Text>
            <View style={styles.dateRow}>
              <DatePickerField value={startDate} onChange={setStartDate} placeholder="Start date" style={styles.dateInput} />
              <DatePickerField value={endDate} onChange={setEndDate} placeholder="End date" allowClear style={styles.dateInput} />
            </View>
          </ScrollView>
          <TouchableOpacity style={styles.createButton} onPress={createBudget}><Text style={styles.createButtonText}>Create Budget</Text></TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function ProgressRing({ spent, ratio }: { spent: number; ratio: number }) {
  const size = 126;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(ratio, 1);
  return (
    <View style={styles.ringWrap}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#1A1A2E" strokeWidth={12} opacity={0.12} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#E94560" strokeWidth={12} strokeLinecap="round" fill="none" strokeDasharray={`${progress * circumference} ${circumference}`} rotation="-90" origin={`${size / 2}, ${size / 2}`} />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={styles.ringLabel}>Spent</Text>
        <Text style={styles.ringValue}>{formatCurrency(spent)}</Text>
      </View>
    </View>
  );
}

function BudgetCard({ budget, expanded, breakdown, viewStart, viewEnd, onPress }: { budget: Budget; expanded: boolean; breakdown: DailyBreakdown[]; viewStart: Date; viewEnd: Date; onPress: () => void }) {
  const spent = Number(budget.current_spending || 0);
  const amount = Number(budget.amount || 0);
  const ratio = amount > 0 ? spent / amount : 0;
  const remaining = amount - spent;
  const color = progressColor(ratio);
  const maxDaily = Math.max(1, ...breakdown.map((item) => item.total));
  const periodNote = budgetPeriodNote(budget, viewStart, viewEnd);

  return (
    <TouchableOpacity style={[styles.budgetCard, ratio > 1 && styles.overBudgetCard]} onPress={onPress} activeOpacity={0.84}>
      <View style={styles.budgetTopRow}>
        <View style={[styles.categoryCircle, { backgroundColor: `${budget.category_color || color}18` }]}> 
          <Feather name={featherIconName(budget.category_icon, 'tag')} size={20} color={budget.category_color || color} />
        </View>
        <View style={styles.budgetCenter}>
          <View style={styles.budgetNameRow}>
            <Text style={styles.budgetName}>{budget.category_name || 'Budget'}</Text>
            <Text style={styles.periodLabel}>{budget.period}</Text>
          </View>
          {periodNote ? (
            <View style={styles.periodNotice}>
              <Feather name="calendar" size={12} color="#0F3460" />
              <Text style={styles.periodNoticeText}>{periodNote}</Text>
            </View>
          ) : null}
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: color }]} /></View>
        </View>
        <View style={styles.budgetRight}>
          {ratio > 1 ? <View style={styles.warningBadge}><Text style={styles.warningText}>!</Text></View> : null}
          <Text style={styles.spentText}>{formatCurrency(spent)} / {formatCurrency(amount)}</Text>
          <Text style={[styles.remainingSmall, { color: remaining >= 0 ? '#27AE60' : '#E74C3C' }]}>{remaining >= 0 ? `${formatCurrency(remaining)} left` : `Over by ${formatCurrency(Math.abs(remaining))}`}</Text>
        </View>
      </View>
      {expanded ? (
        <View style={styles.breakdownWrap}>
          <Text style={styles.breakdownTitle}>Daily breakdown</Text>
          <View style={styles.dailyBars}>{breakdown.length ? breakdown.map((item) => <View key={item.label} style={styles.dailyBarColumn}><View style={[styles.dailyBar, { height: 8 + (item.total / maxDaily) * 72, backgroundColor: color }]} /><Text style={styles.dailyLabel}>{item.label}</Text></View>) : <Text style={styles.emptyText}>No spending for this budget in the selected month.</Text>}</View>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { height: 72, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  monthButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  monthTitle: { color: '#1A1A2E', fontSize: 20, fontWeight: '900' },
  content: { padding: 20, paddingBottom: 120 },
  summaryCard: { borderRadius: 20, backgroundColor: '#FFFFFF', padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#000000', marginBottom: 18 },
  summaryLabel: { color: '#6C757D', fontSize: 13, fontWeight: '800' },
  summaryTotal: { color: '#1A1A2E', fontSize: 28, fontWeight: '900', marginTop: 8 },
  remainingText: { fontSize: 14, fontWeight: '900', marginTop: 10 },
  ringWrap: { width: 126, height: 126 },
  ringCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ringLabel: { color: '#6C757D', fontSize: 11, fontWeight: '800' },
  ringValue: { color: '#1A1A2E', fontSize: 16, fontWeight: '900', marginTop: 4 },
  loader: { marginVertical: 24 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#FDECEC', padding: 12, marginBottom: 14 },
  errorText: { color: '#E74C3C', fontSize: 13, fontWeight: '800', flex: 1 },
  monthFilterNotice: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, backgroundColor: '#EAF1F8', padding: 12, marginBottom: 14 },
  monthFilterText: { color: '#0F3460', fontSize: 13, fontWeight: '800', marginLeft: 8, flex: 1 },
  budgetCard: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 16, marginBottom: 14, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  overBudgetCard: { backgroundColor: '#FFF1F1' },
  budgetTopRow: { flexDirection: 'row', alignItems: 'center' },
  categoryCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  budgetCenter: { flex: 1, minWidth: 0 },
  budgetNameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  budgetName: { color: '#1A1A2E', fontSize: 15, fontWeight: '900', flex: 1 },
  periodLabel: { color: '#6C757D', fontSize: 11, fontWeight: '800', textTransform: 'capitalize' },
  periodNotice: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', borderRadius: 999, backgroundColor: '#EAF1F8', paddingHorizontal: 9, paddingVertical: 5, marginBottom: 10 },
  periodNoticeText: { color: '#0F3460', fontSize: 11, fontWeight: '800', marginLeft: 5 },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: '#EEF0F2', overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 999 },
  budgetRight: { width: 104, alignItems: 'flex-end', marginLeft: 12 },
  warningBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#E74C3C', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  warningText: { color: '#FFFFFF', fontWeight: '900' },
  spentText: { color: '#1A1A2E', fontSize: 12, fontWeight: '900', textAlign: 'right' },
  remainingSmall: { fontSize: 11, fontWeight: '900', marginTop: 5, textAlign: 'right' },
  breakdownWrap: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#EEF0F2', paddingTop: 14 },
  breakdownTitle: { color: '#1A1A2E', fontSize: 13, fontWeight: '900', marginBottom: 10 },
  dailyBars: { minHeight: 112, flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  dailyBarColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  dailyBar: { width: 5, borderRadius: 4 },
  dailyLabel: { color: '#ADB5BD', fontSize: 8, marginTop: 4 },
  emptyState: { alignItems: 'center', padding: 36, borderRadius: 18, backgroundColor: '#FFFFFF' },
  emptyTitle: { color: '#1A1A2E', fontSize: 17, fontWeight: '900', marginTop: 12 },
  emptyText: { color: '#6C757D', fontSize: 13, textAlign: 'center', marginTop: 6 },
  fab: { position: 'absolute', right: 24, bottom: 28, width: 62, height: 62, borderRadius: 31, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000' },
  modal: { margin: 0, justifyContent: 'flex-end' },
  modalSheet: { maxHeight: '90%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { color: '#1A1A2E', fontSize: 24, fontWeight: '900' },
  fieldLabel: { color: '#1A1A2E', fontSize: 15, fontWeight: '900', marginTop: 18, marginBottom: 10 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryChoice: { width: '30.8%', minHeight: 78, borderRadius: 14, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center', padding: 8 },
  categoryChoiceActive: { backgroundColor: '#E94560' },
  categoryChoiceText: { color: '#1A1A2E', fontSize: 12, fontWeight: '800', marginTop: 6 },
  categoryChoiceTextActive: { color: '#FFFFFF' },
  input: { height: 48, borderRadius: 12, backgroundColor: '#F5F5F5', paddingHorizontal: 14, color: '#1A1A2E' },
  periodRow: { flexDirection: 'row', gap: 10 },
  periodPill: { flex: 1, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F5' },
  periodPillActive: { backgroundColor: '#E94560' },
  periodText: { color: '#6C757D', fontWeight: '900', textTransform: 'capitalize' },
  periodTextActive: { color: '#FFFFFF' },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateInput: { flex: 1, height: 48, borderRadius: 12, backgroundColor: '#F5F5F5', paddingHorizontal: 12 },
  createButton: { height: 52, borderRadius: 12, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  createButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});
