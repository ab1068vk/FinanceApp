import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Modal from 'react-native-modal';
import Feather from '@expo/vector-icons/Feather';
import { format, isToday, isYesterday } from 'date-fns';
import { StackScreenProps } from '@react-navigation/stack';
import { DatePickerField } from '../../components/common/DatePickerField';
import { TransactionListItem } from '../../components/common/TransactionListItem';
import { showToast } from '../../components/common/Toast';
import api from '../../services/api';
import { Account } from '../../store';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchAccounts } from '../../store/slices/accountsSlice';
import {
  bulkDeleteTransactions,
  bulkUpdateTransactionCategory,
  fetchMoreTransactions,
  fetchTransactionSummary,
  fetchTransactions,
  Transaction,
  TransactionFilters,
  TransactionType,
} from '../../store/slices/transactionsSlice';
import { useTheme } from '../../theme';
import { TransactionsStackParamList } from '../../navigation';
import { featherIconName } from '../../utils/icons';
import { ListPayload, unwrapList } from '../../types/api';
import { sanitizeDecimalInput } from '../../utils/numberInput';

type Props = StackScreenProps<TransactionsStackParamList, 'TransactionsHome'>;
type Category = { id: string; name: string; icon?: string; color?: string; type?: 'income' | 'expense' };
type TypeFilter = 'all' | TransactionType;

type GroupedItem =
  | { kind: 'header'; id: string; title: string }
  | { kind: 'transaction'; id: string; transaction: Transaction };

function defaultRange() {
  const now = new Date();
  return {
    start_date: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    end_date: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString(),
  };
}

function dateLabel(date: string) {
  const parsed = new Date(date);
  if (isToday(parsed)) return 'Today';
  if (isYesterday(parsed)) return 'Yesterday';
  return format(parsed, 'MMMM d, yyyy');
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
}

export default function TransactionsScreen({ navigation }: Props) {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const { accounts } = useAppSelector((state) => state.accounts);
  const { transactions, pagination, summary, isLoading, isLoadingMore, filters } = useAppSelector((state) => state.transactions);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [range, setRange] = useState(defaultRange());
  const [filterVisible, setFilterVisible] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [draftFrom, setDraftFrom] = useState(range.start_date.slice(0, 10));
  const [draftTo, setDraftTo] = useState(range.end_date.slice(0, 10));
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [modalType, setModalType] = useState<TypeFilter>('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [bulkCategoryVisible, setBulkCategoryVisible] = useState(false);
  const [bulkCategoryId, setBulkCategoryId] = useState('');

  const loadTransactions = useCallback((overrides: Partial<TransactionFilters> = {}) => {
    const nextFilters: TransactionFilters = {
      ...range,
      search: search.trim() || undefined,
      type: typeFilter === 'all' ? undefined : typeFilter,
      account_id: selectedAccounts[0],
      category_id: selectedCategories[0],
      min_amount: minAmount || undefined,
      max_amount: maxAmount || undefined,
      page: 1,
      limit: 20,
      ...overrides,
    };
    dispatch(fetchTransactions(nextFilters));
    dispatch(fetchTransactionSummary({ start_date: nextFilters.start_date, end_date: nextFilters.end_date }));
  }, [dispatch, range, search, typeFilter, selectedAccounts, selectedCategories, minAmount, maxAmount]);

  useEffect(() => {
    dispatch(fetchAccounts());
    api.get<ListPayload<Category>>('/api/categories', { params: { page: 1, limit: 200 } }).then((response) => setCategories(unwrapList(response.data))).catch(() => setCategories([]));
  }, [dispatch]);

  useEffect(() => {
    const timer = setTimeout(() => loadTransactions(), 300);
    return () => clearTimeout(timer);
  }, [loadTransactions]);

  const groupedData = useMemo<GroupedItem[]>(() => {
    const data: GroupedItem[] = [];
    let lastHeader = '';

    for (const transaction of transactions) {
      const header = dateLabel(transaction.date);
      if (header !== lastHeader) {
        data.push({ kind: 'header', id: `header-${transaction.date}-${header}`, title: header });
        lastHeader = header;
      }
      data.push({ kind: 'transaction', id: transaction.id, transaction });
    }
    return data;
  }, [transactions]);

  const hasMore = pagination.page < pagination.totalPages;
  const selectionMode = selectedTransactionIds.length > 0;
  const selectedTransactionSet = useMemo(() => new Set(selectedTransactionIds), [selectedTransactionIds]);

  const toggleTransactionSelection = (id: string) => {
    setSelectedTransactionIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const openBulkCategory = () => {
    const firstCategory = categories[0]?.id || '';
    if (!firstCategory) {
      showToast({ type: 'error', text1: 'No categories available' });
      return;
    }
    setBulkCategoryId(firstCategory);
    setBulkCategoryVisible(true);
  };

  const applyBulkCategory = async () => {
    if (!bulkCategoryId) {
      showToast({ type: 'error', text1: 'Choose a category' });
      return;
    }

    try {
      await dispatch(bulkUpdateTransactionCategory({ ids: selectedTransactionIds, categoryId: bulkCategoryId })).unwrap();
      setSelectedTransactionIds([]);
      setBulkCategoryVisible(false);
      loadTransactions(filters);
      showToast({ type: 'success', text1: 'Transactions updated' });
    } catch (error) {
      showToast({ type: 'error', text1: 'Bulk update failed', text2: typeof error === 'string' ? error : 'Please try again.' });
    }
  };

  const confirmBulkDelete = () => {
    Alert.alert(
      'Delete selected transactions?',
      `This will delete ${selectedTransactionIds.length} transaction${selectedTransactionIds.length === 1 ? '' : 's'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await dispatch(bulkDeleteTransactions(selectedTransactionIds)).unwrap();
              setSelectedTransactionIds([]);
              loadTransactions(filters);
              showToast({ type: 'success', text1: 'Transactions deleted' });
            } catch (error) {
              showToast({ type: 'error', text1: 'Bulk delete failed', text2: typeof error === 'string' ? error : 'Please try again.' });
            }
          },
        },
      ]
    );
  };

  const applyFilters = () => {
    const startDate = new Date(draftFrom);
    const endDate = new Date(draftTo);
    if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
      setRange({ start_date: startDate.toISOString(), end_date: endDate.toISOString() });
    }
    setTypeFilter(modalType);
    setFilterVisible(false);
  };

  const resetFilters = () => {
    const nextRange = defaultRange();
    setRange(nextRange);
    setDraftFrom(nextRange.start_date.slice(0, 10));
    setDraftTo(nextRange.end_date.slice(0, 10));
    setSelectedAccounts([]);
    setSelectedCategories([]);
    setTypeFilter('all');
    setModalType('all');
    setMinAmount('');
    setMaxAmount('');
    setSearch('');
  };

  return (
    <View style={styles.root}>
      <View style={styles.topBlock}>
        <View style={styles.searchRow}>
          <View style={[styles.searchBar, theme.shadows.small]}>
            <Feather name="search" size={20} color={theme.colors.text.secondary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search transactions"
              placeholderTextColor={theme.colors.text.light}
              style={styles.searchInput}
            />
          </View>
          <TouchableOpacity style={[styles.filterButton, theme.shadows.small]} onPress={() => setFilterVisible(true)}>
            <Feather name="sliders" size={20} color={theme.colors.accent} />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {(['all', 'income', 'expense', 'transfer'] as TypeFilter[]).map((type) => (
            <TouchableOpacity key={type} style={[styles.chip, typeFilter === type && styles.activeChip]} onPress={() => setTypeFilter(type)}>
              <Text style={[styles.chipText, typeFilter === type && styles.activeChipText]}>{type === 'all' ? 'All' : type === 'expense' ? 'Expenses' : `${type.charAt(0).toUpperCase()}${type.slice(1)}s`}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity style={styles.dateRow} onPress={() => setFilterVisible(true)} activeOpacity={0.75}>
          <Text style={styles.dateRangeText}>This Month</Text>
          <Feather name="chevron-down" size={18} color={theme.colors.text.secondary} />
        </TouchableOpacity>

        <View style={styles.summaryRow}>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Income</Text>
            <Text style={[styles.summaryValue, { color: theme.colors.success }]}>{formatCurrency(summary.total_income)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Expenses</Text>
            <Text style={[styles.summaryValue, { color: theme.colors.danger }]}>{formatCurrency(summary.total_expense)}</Text>
          </View>
        </View>
      </View>

      {selectionMode ? (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkCount}>{selectedTransactionIds.length} selected</Text>
          <TouchableOpacity style={styles.bulkAction} onPress={openBulkCategory}>
            <Feather name="tag" size={16} color="#E94560" />
            <Text style={styles.bulkActionText}>Categorize</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bulkAction} onPress={confirmBulkDelete}>
            <Feather name="trash-2" size={16} color="#E94560" />
            <Text style={styles.bulkActionText}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.bulkClear} onPress={() => setSelectedTransactionIds([])}>
            <Feather name="x" size={18} color="#6C757D" />
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={groupedData}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshing={isLoading}
        onRefresh={() => loadTransactions(filters)}
        renderItem={({ item }) => {
          if (item.kind === 'header') return <Text style={styles.sectionHeader}>{item.title}</Text>;
          const selected = selectedTransactionSet.has(item.transaction.id);
          return (
            <TransactionListItem
              transaction={item.transaction}
              selected={selected}
              selectionMode={selectionMode}
              onLongPress={() => toggleTransactionSelection(item.transaction.id)}
              onPress={() => selectionMode ? toggleTransactionSelection(item.transaction.id) : navigation.navigate('TransactionDetail', { id: item.transaction.id })}
            />
          );
        }}
        ListEmptyComponent={!isLoading ? <EmptyTransactions onPress={() => navigation.navigate('AddTransaction')} /> : null}
        ListFooterComponent={hasMore ? (
          <TouchableOpacity style={styles.loadMoreButton} onPress={() => dispatch(fetchMoreTransactions())} disabled={isLoadingMore}>
            {isLoadingMore ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.loadMoreText}>Load More</Text>}
          </TouchableOpacity>
        ) : <View style={{ height: 90 }} />}
      />

      <TouchableOpacity style={[styles.fab, theme.shadows.large]} onPress={() => navigation.navigate('AddTransaction')}>
        <Feather name="plus" size={30} color="#FFFFFF" />
      </TouchableOpacity>

      <Modal isVisible={filterVisible} style={styles.modal} onBackdropPress={() => setFilterVisible(false)} onBackButtonPress={() => setFilterVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalSheet}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Filters</Text>
            <TouchableOpacity onPress={() => setFilterVisible(false)}><Feather name="x" size={24} color={theme.colors.text.primary} /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.filterLabel}>Date range</Text>
            <View style={styles.dateInputsRow}>
              <DatePickerField value={draftFrom} onChange={setDraftFrom} placeholder="Start date" style={styles.dateInput} />
              <DatePickerField value={draftTo} onChange={setDraftTo} placeholder="End date" style={styles.dateInput} />
            </View>

            <Text style={styles.filterLabel}>Accounts</Text>
            {accounts.map((account: Account) => (
              <SelectableRow key={account.id} label={account.name} selected={selectedAccounts.includes(account.id)} onPress={() => toggleValue(account.id, selectedAccounts, setSelectedAccounts)} />
            ))}

            <Text style={styles.filterLabel}>Categories</Text>
            <View style={styles.categoryGrid}>
              {categories.map((category) => {
                const selected = selectedCategories.includes(category.id);
                return (
                  <TouchableOpacity key={category.id} style={[styles.categoryChoice, selected && styles.categoryChoiceActive]} onPress={() => toggleValue(category.id, selectedCategories, setSelectedCategories)}>
                    <Feather name={featherIconName(category.icon, 'tag')} size={18} color={selected ? '#FFFFFF' : category.color || theme.colors.accent} />
                    <Text style={[styles.categoryChoiceText, selected && styles.categoryChoiceTextActive]} numberOfLines={1}>{category.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.filterLabel}>Type</Text>
            <View style={styles.typeToggleRow}>
              {(['all', 'income', 'expense', 'transfer'] as TypeFilter[]).map((type) => (
                <TouchableOpacity key={type} style={[styles.typeToggle, modalType === type && styles.activeChip]} onPress={() => setModalType(type)}>
                  <Text style={[styles.typeToggleText, modalType === type && styles.activeChipText]}>{type === 'all' ? 'All' : type}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.filterLabel}>Amount range</Text>
            <View style={styles.dateInputsRow}>
              <TextInput value={minAmount} onChangeText={(value) => setMinAmount(sanitizeDecimalInput(value))} placeholder="Min" keyboardType="decimal-pad" style={styles.dateInput} />
              <TextInput value={maxAmount} onChangeText={(value) => setMaxAmount(sanitizeDecimalInput(value))} placeholder="Max" keyboardType="decimal-pad" style={styles.dateInput} />
            </View>
          </ScrollView>
          <TouchableOpacity style={styles.applyButton} onPress={applyFilters}><Text style={styles.applyButtonText}>Apply Filters</Text></TouchableOpacity>
          <TouchableOpacity style={styles.resetButton} onPress={resetFilters}><Text style={styles.resetText}>Reset</Text></TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      <Modal isVisible={bulkCategoryVisible} style={styles.modal} onBackdropPress={() => setBulkCategoryVisible(false)} onBackButtonPress={() => setBulkCategoryVisible(false)}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Set Category</Text>
            <TouchableOpacity onPress={() => setBulkCategoryVisible(false)}><Feather name="x" size={24} color={theme.colors.text.primary} /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={styles.bulkCategoryList}>
            {categories.map((category) => {
              const selected = bulkCategoryId === category.id;
              return (
                <TouchableOpacity key={category.id} style={styles.bulkCategoryRow} onPress={() => setBulkCategoryId(category.id)}>
                  <Feather name={selected ? 'check-circle' : 'circle'} size={20} color={selected ? '#E94560' : '#ADB5BD'} />
                  <Feather name={featherIconName(category.icon, 'tag')} size={18} color={category.color || theme.colors.accent} style={styles.bulkCategoryIcon} />
                  <Text style={styles.bulkCategoryName}>{category.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={styles.applyButton} onPress={applyBulkCategory}><Text style={styles.applyButtonText}>Apply to Selected</Text></TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

function toggleValue(value: string, current: string[], setter: (values: string[]) => void) {
  setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
}

function SelectableRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.selectableRow} onPress={onPress}>
      <Feather name={selected ? 'check-square' : 'square'} size={20} color={selected ? '#E94560' : '#ADB5BD'} />
      <Text style={styles.selectableText}>{label}</Text>
    </TouchableOpacity>
  );
}

function EmptyTransactions({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyCircle}><Feather name="file-plus" size={34} color="#ADB5BD" /></View>
      <Text style={styles.emptyTitle}>Record your first transaction</Text>
      <TouchableOpacity style={styles.emptyButton} onPress={onPress}><Text style={styles.emptyButtonText}>Add Transaction</Text></TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  topBlock: { backgroundColor: '#F8F9FA', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center' },
  searchBar: { flex: 1, height: 48, borderRadius: 14, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, shadowColor: '#000000' },
  searchInput: { flex: 1, marginLeft: 10, color: '#1A1A2E', fontSize: 15 },
  filterButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginLeft: 10, shadowColor: '#000000' },
  chipsRow: { paddingVertical: 14 },
  chip: { height: 36, borderRadius: 18, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', marginRight: 10, borderWidth: 1, borderColor: '#DEE2E6' },
  activeChip: { backgroundColor: '#E94560', borderColor: '#E94560' },
  chipText: { color: '#6C757D', fontSize: 13, fontWeight: '800', textTransform: 'capitalize' },
  activeChipText: { color: '#FFFFFF' },
  dateRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 12 },
  dateRangeText: { color: '#1A1A2E', fontSize: 15, fontWeight: '800', marginRight: 4 },
  summaryRow: { height: 74, borderRadius: 16, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', padding: 14 },
  summaryBox: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, height: 38, backgroundColor: '#DEE2E6' },
  summaryLabel: { color: '#6C757D', fontSize: 12, fontWeight: '700' },
  summaryValue: { fontSize: 20, fontWeight: '900', marginTop: 5 },
  bulkBar: { minHeight: 52, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#EEF0F2', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 10 },
  bulkCount: { color: '#1A1A2E', fontSize: 14, fontWeight: '900', flex: 1 },
  bulkAction: { height: 36, borderRadius: 10, backgroundColor: '#FFF1F3', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6 },
  bulkActionText: { color: '#E94560', fontSize: 12, fontWeight: '900' },
  bulkClear: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 20, paddingBottom: 110 },
  sectionHeader: { color: '#6C757D', fontSize: 13, fontWeight: '900', marginTop: 18, marginBottom: 8, textTransform: 'uppercase' },
  loadMoreButton: { height: 48, borderRadius: 12, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  loadMoreText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  fab: { position: 'absolute', right: 24, bottom: 28, width: 62, height: 62, borderRadius: 31, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000' },
  modal: { margin: 0, justifyContent: 'flex-end' },
  modalSheet: { maxHeight: '92%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { color: '#1A1A2E', fontSize: 24, fontWeight: '900' },
  filterLabel: { color: '#1A1A2E', fontSize: 15, fontWeight: '900', marginTop: 18, marginBottom: 10 },
  dateInputsRow: { flexDirection: 'row', gap: 10 },
  dateInput: { flex: 1, height: 46, borderRadius: 12, backgroundColor: '#F5F5F5', paddingHorizontal: 12, color: '#1A1A2E' },
  selectableRow: { height: 42, flexDirection: 'row', alignItems: 'center' },
  selectableText: { color: '#1A1A2E', fontSize: 14, fontWeight: '700', marginLeft: 10 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryChoice: { width: '30.8%', minHeight: 74, borderRadius: 14, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center', padding: 8 },
  categoryChoiceActive: { backgroundColor: '#E94560' },
  categoryChoiceText: { color: '#1A1A2E', fontSize: 12, fontWeight: '700', marginTop: 6 },
  categoryChoiceTextActive: { color: '#FFFFFF' },
  typeToggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeToggle: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#DEE2E6' },
  typeToggleText: { color: '#6C757D', fontSize: 13, fontWeight: '800', textTransform: 'capitalize' },
  applyButton: { height: 52, borderRadius: 12, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  applyButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  resetButton: { alignItems: 'center', paddingVertical: 14 },
  resetText: { color: '#E94560', fontSize: 14, fontWeight: '900', textDecorationLine: 'underline' },
  bulkCategoryList: { maxHeight: 420 },
  bulkCategoryRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center' },
  bulkCategoryIcon: { marginLeft: 12, marginRight: 10 },
  bulkCategoryName: { color: '#1A1A2E', fontSize: 15, fontWeight: '800', flex: 1 },
  emptyState: { alignItems: 'center', paddingVertical: 54 },
  emptyCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { color: '#1A1A2E', fontSize: 17, fontWeight: '900', marginBottom: 14 },
  emptyButton: { borderRadius: 12, backgroundColor: '#E94560', paddingHorizontal: 18, paddingVertical: 12 },
  emptyButtonText: { color: '#FFFFFF', fontWeight: '900' },
});
