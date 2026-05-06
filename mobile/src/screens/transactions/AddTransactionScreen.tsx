import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import { useFocusEffect } from '@react-navigation/native';
import { showToast } from '../../components/common/Toast';
import { DatePickerField } from '../../components/common/DatePickerField';
import api from '../../services/api';
import { Account } from '../../store';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchAccounts } from '../../store/slices/accountsSlice';
import { createTransaction, TransactionType } from '../../store/slices/transactionsSlice';
import { useTheme } from '../../theme';
import { TransactionsStackParamList } from '../../navigation';
import { featherIconName } from '../../utils/icons';
import { ListPayload, unwrapList } from '../../types/api';

type Props = StackScreenProps<TransactionsStackParamList, 'AddTransaction'>;
type Category = { id: string; name: string; icon?: string; color?: string; type?: 'income' | 'expense'; is_default?: number; sort_order?: number };
type Interval = 'daily' | 'weekly' | 'monthly' | 'yearly';
type CategoryUsage = { count: number; lastUsed: number };

const typeColors: Record<TransactionType, string> = {
  expense: '#E74C3C',
  income: '#27AE60',
  transfer: '#0F3460',
};
const MAX_TRANSACTION_AMOUNT = 100000000;
const protectedAccountTypes = new Set(['checking', 'savings', 'cash']);

function formatBalance(account: Account) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: account.currency || 'USD', maximumFractionDigits: 0 }).format(account.current_balance ?? account.balance ?? 0);
}

function isValidDate(dateString: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === dateString;
}

function categoryTypeRank(category: Category) {
  if (category.type === 'expense') return 0;
  if (category.type === 'income') return 1;
  return 2;
}

export default function AddTransactionScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const accounts = useAppSelector((state) => state.accounts.accounts);
  const transactions = useAppSelector((state) => state.transactions.transactions);
  const isLoading = useAppSelector((state) => state.transactions.isLoading);
  const [type, setType] = useState<TransactionType>(route.params?.defaultType ?? 'expense');
  const [amount, setAmount] = useState('0');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [recurring, setRecurring] = useState(false);
  const [interval, setInterval] = useState<Interval>('monthly');

  const resetForm = useCallback(() => {
    setType(route.params?.defaultType ?? 'expense');
    setAmount('0');
    setDescription('');
    setCategoryId('');
    setAccountId('');
    setToAccountId('');
    setDate(new Date().toISOString().slice(0, 10));
    setExpanded(false);
    setNote('');
    setTagInput('');
    setTags([]);
    setRecurring(false);
    setInterval('monthly');
  }, [route.params?.defaultType]);

  useFocusEffect(
    useCallback(() => {
      resetForm();
      dispatch(fetchAccounts());
      api.get<ListPayload<Category>>('/api/categories', { params: { page: 1, limit: 200 } }).then((response) => setCategories(unwrapList(response.data))).catch(() => setCategories([]));
    }, [dispatch, resetForm]),
  );

  useEffect(() => {
    setCategoryId('');
  }, [type]);

  useEffect(() => {
    if (toAccountId && toAccountId === accountId) setToAccountId('');
  }, [accountId, toAccountId]);

  const amountNumber = Number(amount || '0');
  const selectedAccount = useMemo(() => accounts.find((account) => account.id === accountId), [accountId, accounts]);
  const amountDisplay = useMemo(() => `$${amountNumber.toFixed(2)}`, [amountNumber]);
  const categoryUsage = useMemo(() => {
    const usage = new Map<string, CategoryUsage>();
    transactions.forEach((transaction) => {
      if (!transaction.category_id) return;
      const dateTime = new Date(transaction.date).getTime();
      const current = usage.get(transaction.category_id) || { count: 0, lastUsed: 0 };
      usage.set(transaction.category_id, {
        count: current.count + 1,
        lastUsed: Math.max(current.lastUsed, Number.isNaN(dateTime) ? 0 : dateTime),
      });
    });
    return usage;
  }, [transactions]);
  const filteredCategories = useMemo(() => categories
    .filter((category) => type === 'transfer' || !category.type || category.type === type)
    .sort((left, right) => {
      const typeDiff = categoryTypeRank(left) - categoryTypeRank(right);
      if (typeDiff) return typeDiff;
      const customDiff = (left.is_default || 0) - (right.is_default || 0);
      if (customDiff) return customDiff;
      const leftUsage = categoryUsage.get(left.id) || { count: 0, lastUsed: 0 };
      const rightUsage = categoryUsage.get(right.id) || { count: 0, lastUsed: 0 };
      if (rightUsage.count !== leftUsage.count) return rightUsage.count - leftUsage.count;
      if (rightUsage.lastUsed !== leftUsage.lastUsed) return rightUsage.lastUsed - leftUsage.lastUsed;
      if ((left.sort_order || 0) !== (right.sort_order || 0)) return (left.sort_order || 0) - (right.sort_order || 0);
      return left.name.localeCompare(right.name);
    }), [categories, categoryUsage, type]);
  const categoryGroups = useMemo(() => {
    if (type !== 'transfer') return [{ title: null, data: filteredCategories }];
    return [
      { title: 'Expense', data: filteredCategories.filter((category) => category.type === 'expense') },
      { title: 'Income', data: filteredCategories.filter((category) => category.type === 'income') },
      { title: 'Other', data: filteredCategories.filter((category) => !category.type) },
    ].filter((group) => group.data.length > 0);
  }, [filteredCategories, type]);

  const pressKey = (key: string) => {
    setAmount((current) => {
      if (key === 'back') return current.length > 1 ? current.slice(0, -1) : '0';
      if (key === '.') return current.includes('.') ? current : `${current}.`;
      if (current === '0') return key;
      const next = `${current}${key}`;
      const [, decimals] = next.split('.');
      return decimals && decimals.length > 2 ? current : next;
    });
  };

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) setTags((current) => [...current, trimmed]);
    setTagInput('');
  };

  const save = async () => {
    if (amountNumber <= 0) {
      showToast({ type: 'error', text1: 'Amount required', text2: 'Enter an amount greater than zero.' });
      return;
    }
    if (amountNumber > MAX_TRANSACTION_AMOUNT) {
      showToast({ type: 'error', text1: 'Amount too large', text2: 'Transactions cannot exceed $100,000,000.' });
      return;
    }
    if (type !== 'transfer' && !categoryId) {
      showToast({ type: 'error', text1: 'Category required', text2: 'Choose a category for this transaction.' });
      return;
    }
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) {
      showToast({ type: 'error', text1: 'Transfer account required', text2: 'Choose a different destination account.' });
      return;
    }
    if (!isValidDate(date)) {
      showToast({ type: 'error', text1: 'Invalid date', text2: 'Please enter a valid date (YYYY-MM-DD).' });
      return;
    }
    if (selectedAccount && (type === 'expense' || type === 'transfer') && protectedAccountTypes.has(selectedAccount.type)) {
      const balance = Number(selectedAccount.current_balance ?? selectedAccount.balance ?? 0);
      const overdraftLimit = Math.max(Number(selectedAccount.overdraft_limit || 0), 0);
      if (balance - amountNumber < -overdraftLimit) {
        showToast({ type: 'error', text1: 'Overdraft limit exceeded', text2: `${selectedAccount.name} does not have enough available balance.` });
        return;
      }
    }

    try {
      await dispatch(createTransaction({
        account_id: accountId || undefined,
        to_account_id: type === 'transfer' ? toAccountId : undefined,
        category_id: categoryId || undefined,
        type,
        amount: amountNumber,
        description: description.trim() || undefined,
        note: note.trim() || undefined,
        date: new Date(`${date}T00:00:00.000Z`).toISOString(),
        tags,
        recurring,
        recurring_interval: recurring ? interval : undefined,
      })).unwrap();
      showToast({ type: 'success', text1: 'Transaction saved' });
      dispatch(fetchAccounts());
      resetForm();
      navigation.goBack();
    } catch (error) {
      const message = typeof error === 'string' ? error : 'Unable to save transaction.';
      showToast({ type: 'error', text1: 'Save failed', text2: message });
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}><Feather name="x" size={24} color="#1A1A2E" /></TouchableOpacity>
          <Text style={styles.title}>New Transaction</Text>
          <View style={styles.closeButton} />
        </View>

        <View style={styles.typeRow}>
          {(['expense', 'income', 'transfer'] as TransactionType[]).map((item) => (
            <TouchableOpacity key={item} style={[styles.typePill, type === item && { backgroundColor: typeColors[item], borderColor: typeColors[item] }]} onPress={() => setType(item)}>
              <Text style={[styles.typePillText, type === item && styles.typePillTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={[styles.amount, { color: typeColors[type] }]}>{amountDisplay}</Text>
          <View style={styles.numpad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((key) => (
              <TouchableOpacity key={key} style={styles.key} onPress={() => pressKey(key)}>
                {key === 'back' ? <Feather name="delete" size={24} color="#1A1A2E" /> : <Text style={styles.keyText}>{key}</Text>}
              </TouchableOpacity>
            ))}
          </View>

          <TextInput value={description} onChangeText={setDescription} placeholder="What was this for?" placeholderTextColor="#ADB5BD" style={styles.descriptionInput} />

          <Text style={styles.sectionTitle}>Category {type === 'transfer' ? <Text style={styles.optionalText}>Optional</Text> : null}</Text>
          {categoryGroups.map((group) => (
            <View key={group.title || 'categories'}>
              {group.title ? <Text style={styles.categoryGroupTitle}>{group.title}</Text> : null}
              <View style={styles.categoryGrid}>
                {group.data.map((category) => {
                  const selected = category.id === categoryId;
                  return (
                    <TouchableOpacity key={category.id} style={[styles.categoryItem, selected && styles.categoryItemActive]} onPress={() => setCategoryId(category.id)}>
                      <View style={[styles.categoryCircle, { backgroundColor: selected ? '#E94560' : `${category.color || '#0F3460'}18` }]}> 
                        <Feather name={featherIconName(category.icon, 'tag')} size={20} color={selected ? '#FFFFFF' : category.color || '#0F3460'} />
                      </View>
                      <Text style={[styles.categoryLabel, selected && styles.categoryLabelActive]} numberOfLines={1}>{category.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}

          <Text style={styles.sectionTitle}>Account <Text style={styles.optionalText}>Optional</Text></Text>
          <AccountSelector accounts={accounts} selectedId={accountId} onSelect={setAccountId} allowNoAccount />
          {type === 'transfer' ? (
            <>
              <Text style={styles.sectionTitle}>To Account {!toAccountId ? <Text style={styles.requiredText}>* Required</Text> : null}</Text>
              <AccountSelector accounts={accounts.filter((account) => account.id !== accountId)} selectedId={toAccountId} onSelect={setToAccountId} />
            </>
          ) : null}

          <Text style={styles.sectionTitle}>Date</Text>
          <DatePickerField value={date} onChange={setDate} placeholder="Transaction date" style={styles.dateInput} />

          <TouchableOpacity style={styles.moreRow} onPress={() => setExpanded((value) => !value)}>
            <Text style={styles.moreText}>More Options</Text>
            <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color="#6C757D" />
          </TouchableOpacity>

          {expanded ? (
            <View>
              <TextInput value={note} onChangeText={setNote} placeholder="Note" placeholderTextColor="#ADB5BD" multiline style={styles.noteInput} />
              <View style={styles.tagInputRow}>
                <TextInput value={tagInput} onChangeText={setTagInput} onSubmitEditing={addTag} placeholder="Add tag" style={styles.tagInput} />
                <TouchableOpacity style={styles.tagAddButton} onPress={addTag}><Feather name="plus" size={20} color="#FFFFFF" /></TouchableOpacity>
              </View>
              <View style={styles.tagsRow}>{tags.map((tag) => <TouchableOpacity key={tag} style={styles.tag} onPress={() => setTags((current) => current.filter((item) => item !== tag))}><Text style={styles.tagText}>{tag}</Text></TouchableOpacity>)}</View>
              <View style={styles.recurringRow}>
                <Text style={styles.recurringText}>Recurring</Text>
                <Switch value={recurring} onValueChange={setRecurring} trackColor={{ true: '#E94560' }} />
              </View>
              {recurring ? <View style={styles.intervalRow}>{(['daily', 'weekly', 'monthly', 'yearly'] as Interval[]).map((item) => <TouchableOpacity key={item} style={[styles.intervalPill, interval === item && styles.intervalPillActive]} onPress={() => setInterval(item)}><Text style={[styles.intervalText, interval === item && styles.intervalTextActive]}>{item}</Text></TouchableOpacity>)}</View> : null}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.saveButton} onPress={save} disabled={isLoading}>
            {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save Transaction</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function AccountSelector({ accounts, selectedId, onSelect, allowNoAccount = false }: { accounts: Account[]; selectedId: string; onSelect: (id: string) => void; allowNoAccount?: boolean }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accountSelector}>
      {allowNoAccount ? (
        <TouchableOpacity style={styles.accountChoice} onPress={() => onSelect('')}>
          <Text style={styles.accountName}>Default Cash</Text>
          <Text style={styles.accountBalance}>Optional</Text>
        </TouchableOpacity>
      ) : null}
      {accounts.map((account) => {
        const selected = account.id === selectedId;
        return (
          <TouchableOpacity key={account.id} style={[styles.accountChoice, selected && styles.accountChoiceActive]} onPress={() => onSelect(account.id)}>
            <Text style={[styles.accountName, selected && styles.accountNameActive]}>{account.name}</Text>
            <Text style={[styles.accountBalance, selected && styles.accountNameActive]}>{formatBalance(account)}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { height: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, backgroundColor: '#FFFFFF' },
  closeButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#1A1A2E', fontSize: 20, fontWeight: '900' },
  typeRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#FFFFFF' },
  typePill: { flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DEE2E6' },
  typePillText: { color: '#6C757D', fontSize: 14, fontWeight: '900', textTransform: 'capitalize' },
  typePillTextActive: { color: '#FFFFFF' },
  content: { padding: 20, paddingBottom: 120 },
  amount: { fontSize: 48, fontWeight: '900', textAlign: 'center', marginVertical: 14, letterSpacing: 0 },
  numpad: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 18 },
  key: { width: '33.33%', height: 56, alignItems: 'center', justifyContent: 'center' },
  keyText: { color: '#1A1A2E', fontSize: 26, fontWeight: '800' },
  descriptionInput: { height: 50, borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 14, color: '#1A1A2E', fontSize: 15 },
  sectionTitle: { color: '#1A1A2E', fontSize: 16, fontWeight: '900', marginTop: 22, marginBottom: 12 },
  requiredText: { color: '#E74C3C' },
  optionalText: { color: '#6C757D', fontSize: 13 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryGroupTitle: { color: '#6C757D', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', marginBottom: 8 },
  categoryItem: { width: '30.8%', minHeight: 92, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: 8 },
  categoryItemActive: { borderWidth: 2, borderColor: '#E94560' },
  categoryCircle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  categoryLabel: { color: '#1A1A2E', fontSize: 12, fontWeight: '800' },
  categoryLabelActive: { color: '#E94560' },
  accountSelector: { gap: 10 },
  accountChoice: { minWidth: 150, borderRadius: 14, backgroundColor: '#FFFFFF', padding: 14, borderWidth: 1, borderColor: '#FFFFFF' },
  accountChoiceActive: { borderColor: '#E94560', backgroundColor: '#FFF5F7' },
  accountName: { color: '#1A1A2E', fontSize: 14, fontWeight: '900' },
  accountNameActive: { color: '#E94560' },
  accountBalance: { color: '#6C757D', fontSize: 13, marginTop: 6, fontWeight: '700' },
  dateInput: { height: 48, borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 14, color: '#1A1A2E' },
  moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, paddingVertical: 10 },
  moreText: { color: '#1A1A2E', fontSize: 15, fontWeight: '900' },
  noteInput: { minHeight: 92, borderRadius: 14, backgroundColor: '#FFFFFF', padding: 14, color: '#1A1A2E', textAlignVertical: 'top' },
  tagInputRow: { flexDirection: 'row', marginTop: 12 },
  tagInput: { flex: 1, height: 46, borderRadius: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 12 },
  tagAddButton: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  tag: { borderRadius: 999, backgroundColor: '#E9456018', paddingHorizontal: 12, paddingVertical: 7 },
  tagText: { color: '#E94560', fontWeight: '800' },
  recurringRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  recurringText: { color: '#1A1A2E', fontSize: 15, fontWeight: '900' },
  intervalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  intervalPill: { borderRadius: 999, backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 8 },
  intervalPillActive: { backgroundColor: '#E94560' },
  intervalText: { color: '#6C757D', fontWeight: '800', textTransform: 'capitalize' },
  intervalTextActive: { color: '#FFFFFF' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: '#FFFFFF' },
  saveButton: { height: 52, borderRadius: 12, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});
