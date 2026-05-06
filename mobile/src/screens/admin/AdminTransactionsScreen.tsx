import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Modal from 'react-native-modal';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import api from '../../services/api';
import { DatePickerField } from '../../components/common/DatePickerField';
import { showToast } from '../../components/common/Toast';
import { useTheme } from '../../theme';

type AdminTransaction = {
  id: string;
  user_id: string;
  user_email?: string | null;
  user_full_name?: string | null;
  account_name?: string | null;
  category_name?: string | null;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  description?: string | null;
  note?: string | null;
  date: string;
  admin_deleted_at?: string | null;
  admin_delete_reason?: string | null;
};

type ListResponse<T> = { data: T[]; pagination: { total: number; page: number; limit: number; totalPages: number } };

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function niceDate(value?: string | null) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : format(date, 'MMM d, yyyy h:mm a');
}

export default function AdminTransactionsScreen() {
  const theme = useTheme();
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [type, setType] = useState<'all' | AdminTransaction['type']>('all');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [selected, setSelected] = useState<AdminTransaction | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    filters: { padding: theme.spacing.md, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    searchRow: { flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing.sm, backgroundColor: theme.colors.background, gap: theme.spacing.sm },
    dateRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
    dateField: { flex: 1, backgroundColor: theme.colors.background },
    input: { flex: 1, color: theme.colors.text.primary, fontSize: theme.typography.sm },
    chipRow: { gap: theme.spacing.sm, paddingTop: theme.spacing.sm },
    chip: { borderRadius: theme.borderRadius.full, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, marginRight: theme.spacing.sm, backgroundColor: theme.colors.surface },
    chipActive: { borderColor: theme.colors.highlight, backgroundColor: theme.colors.highlight },
    chipText: { color: theme.colors.text.secondary, fontSize: theme.typography.xs, fontWeight: '800', textTransform: 'capitalize' },
    chipTextActive: { color: theme.colors.text.inverse },
    list: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl },
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm, ...theme.shadows.small },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
    title: { color: theme.colors.text.primary, fontSize: theme.typography.md, fontWeight: '800', flex: 1 },
    amount: { fontSize: theme.typography.md, fontWeight: '900' },
    meta: { color: theme.colors.text.secondary, fontSize: theme.typography.sm, marginTop: theme.spacing.xs },
    badge: { alignSelf: 'flex-start', borderRadius: theme.borderRadius.full, paddingHorizontal: theme.spacing.sm, paddingVertical: 3, marginTop: theme.spacing.sm },
    badgeText: { color: theme.colors.text.inverse, fontSize: theme.typography.xs, fontWeight: '800' },
    modal: { margin: theme.spacing.md, justifyContent: 'center' },
    modalCard: { backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.lg, padding: theme.spacing.lg, maxHeight: '85%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md },
    modalTitle: { color: theme.colors.text.primary, fontSize: theme.typography.xl, fontWeight: '800', flex: 1 },
    label: { color: theme.colors.text.secondary, fontSize: theme.typography.xs, fontWeight: '800', textTransform: 'uppercase', marginTop: theme.spacing.md },
    value: { color: theme.colors.text.primary, fontSize: theme.typography.md, fontWeight: '700', marginTop: 3 },
    reasonInput: { minHeight: 82, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text.primary, padding: theme.spacing.sm, marginTop: theme.spacing.sm, textAlignVertical: 'top', backgroundColor: theme.colors.background },
    deleteButton: { height: 48, borderRadius: theme.borderRadius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.danger, marginTop: theme.spacing.md },
    buttonText: { color: theme.colors.text.inverse, fontSize: theme.typography.md, fontWeight: '800' },
    empty: { alignItems: 'center', padding: theme.spacing.xl, gap: theme.spacing.sm },
  }), [theme]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<ListResponse<AdminTransaction>>('/api/admin/transactions', {
        params: {
          limit: 50,
          search: search.trim() || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          type: type === 'all' ? undefined : type,
          include_deleted: includeDeleted || undefined,
        },
      });
      setTransactions(response.data.data || []);
    } catch (error) {
      showToast({ type: 'error', text1: 'Transactions failed to load' });
    } finally {
      setLoading(false);
    }
  }, [endDate, includeDeleted, search, startDate, type]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function softDeleteSelected() {
    if (!selected) return;
    try {
      await api.delete(`/api/admin/transactions/${selected.id}`, { data: { reason: deleteReason } });
      showToast({ type: 'success', text1: 'Transaction soft-deleted' });
      setSelected(null);
      setDeleteReason('');
      load();
    } catch (error) {
      showToast({ type: 'error', text1: 'Delete failed', text2: 'A reason of at least 5 characters is required.' });
    }
  }

  function renderItem({ item }: { item: AdminTransaction }) {
    const color = item.admin_deleted_at ? theme.colors.text.light : item.type === 'income' ? theme.colors.success : item.type === 'expense' ? theme.colors.danger : theme.colors.accent;
    return (
      <Pressable style={styles.card} onPress={() => setSelected(item)}>
        <View style={styles.topRow}>
          <Text style={styles.title} numberOfLines={1}>{item.description || item.category_name || item.type}</Text>
          <Text style={[styles.amount, { color }]}>{currency.format(Number(item.amount || 0))}</Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>{item.user_email || item.user_full_name || item.user_id}</Text>
        <Text style={styles.meta}>{item.account_name || 'No account'} - {niceDate(item.date)}</Text>
        <View style={[styles.badge, { backgroundColor: color }]}><Text style={styles.badgeText}>{item.admin_deleted_at ? 'soft deleted' : item.type}</Text></View>
      </Pressable>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.filters}>
        <View style={styles.searchRow}>
          <Feather name="search" size={18} color={theme.colors.text.secondary} />
          <TextInput value={search} onChangeText={setSearch} onSubmitEditing={load} placeholder="Search user, description, note" placeholderTextColor={theme.colors.text.light} style={styles.input} />
          <Pressable onPress={load}><Feather name="refresh-cw" size={18} color={theme.colors.highlight} /></Pressable>
        </View>
        <View style={styles.dateRow}>
          <DatePickerField value={startDate} onChange={setStartDate} placeholder="Start date" allowClear style={styles.dateField} />
          <DatePickerField value={endDate} onChange={setEndDate} placeholder="End date" allowClear style={styles.dateField} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {(['all', 'income', 'expense', 'transfer'] as const).map((item) => (
            <Pressable key={item} style={[styles.chip, type === item && styles.chipActive]} onPress={() => setType(item)}>
              <Text style={[styles.chipText, type === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.chip, includeDeleted && styles.chipActive]} onPress={() => setIncludeDeleted((value) => !value)}>
            <Text style={[styles.chipText, includeDeleted && styles.chipTextActive]}>include deleted</Text>
          </Pressable>
        </ScrollView>
      </View>

      {loading && transactions.length === 0 ? (
        <View style={styles.empty}><ActivityIndicator color={theme.colors.highlight} /></View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshing={loading}
          onRefresh={load}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<View style={styles.empty}><Feather name="list" size={40} color={theme.colors.text.light} /><Text style={styles.meta}>No transactions match these filters.</Text></View>}
        />
      )}

      <Modal isVisible={selected !== null} onBackdropPress={() => setSelected(null)} style={styles.modal}>
        <View style={styles.modalCard}>
          {selected ? (
            <>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{selected.description || selected.type}</Text>
                <Pressable onPress={() => setSelected(null)}><Feather name="x" size={24} color={theme.colors.text.primary} /></Pressable>
              </View>
              <Text style={styles.label}>User</Text>
              <Text style={styles.value}>{selected.user_email || selected.user_full_name || selected.user_id}</Text>
              <Text style={styles.label}>Transaction</Text>
              <Text style={styles.value}>{selected.type} - {currency.format(Number(selected.amount || 0))}</Text>
              <Text style={styles.value}>{selected.account_name || 'No account'} - {selected.category_name || 'Uncategorized'}</Text>
              <Text style={styles.value}>{niceDate(selected.date)}</Text>
              {selected.note ? <><Text style={styles.label}>Note</Text><Text style={styles.value}>{selected.note}</Text></> : null}
              {selected.admin_deleted_at ? (
                <>
                  <Text style={styles.label}>Soft Delete</Text>
                  <Text style={styles.value}>{selected.admin_delete_reason || 'No reason'} - {niceDate(selected.admin_deleted_at)}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.label}>Audit Reason</Text>
                  <TextInput value={deleteReason} onChangeText={setDeleteReason} placeholder="Required reason" placeholderTextColor={theme.colors.text.light} multiline style={styles.reasonInput} />
                  <Pressable style={styles.deleteButton} onPress={softDeleteSelected}><Text style={styles.buttonText}>Soft Delete Transaction</Text></Pressable>
                </>
              )}
            </>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
