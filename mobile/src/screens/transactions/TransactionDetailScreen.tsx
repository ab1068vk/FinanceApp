import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { format } from 'date-fns';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { deleteTransaction, fetchTransactionById, fetchTransactions, Transaction } from '../../store/slices/transactionsSlice';
import { fetchAccounts as refreshAccounts } from '../../store/slices/accountsSlice';
import { TransactionsStackParamList } from '../../navigation';
import type { FeatherIconName } from '../../utils/icons';

type Props = StackScreenProps<TransactionsStackParamList, 'TransactionDetail'>;

const typeColors = {
  income: '#27AE60',
  expense: '#E74C3C',
  transfer: '#0F3460',
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount || 0);
}

function parseTags(tags: Transaction['tags']): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(String);
  try {
    const parsed = JSON.parse(tags);
    if (Array.isArray(parsed)) return parsed.map(String);
    if (Array.isArray(parsed.values)) return parsed.values.map(String);
    return [];
  } catch {
    return [];
  }
}

function safeFormat(date?: string, pattern = 'MMMM d, yyyy') {
  if (!date) return 'Not set';
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? 'Not set' : format(parsed, pattern);
}

export default function TransactionDetailScreen({ navigation, route }: Props) {
  const dispatch = useAppDispatch();
  const { selectedTransaction, isLoading } = useAppSelector((state) => state.transactions);
  const transaction = selectedTransaction?.id === route.params.id ? selectedTransaction : null;

  useEffect(() => {
    dispatch(fetchTransactionById(route.params.id));
  }, [dispatch, route.params.id]);

  const tags = useMemo(() => parseTags(transaction?.tags), [transaction?.tags]);

  const confirmDelete = () => {
    Alert.alert('Delete transaction?', 'This will permanently delete the transaction and reverse the account balance change.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await dispatch(deleteTransaction(route.params.id)).unwrap();
            dispatch(fetchTransactions({ page: 1, limit: 20 }));
            dispatch(refreshAccounts());
            showToast({ type: 'success', text1: 'Transaction deleted' });
            navigation.goBack();
          } catch (error) {
            showToast({ type: 'error', text1: 'Delete failed', text2: typeof error === 'string' ? error : 'Please try again.' });
          }
        },
      },
    ]);
  };

  if (isLoading && !transaction) {
    return <View style={styles.loading}><ActivityIndicator color="#E94560" /></View>;
  }

  if (!transaction) {
    return (
      <View style={styles.loading}>
        <Text style={styles.missingText}>Transaction not found</Text>
      </View>
    );
  }

  const color = typeColors[transaction.type];
  const sign = transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : '';

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.header, { backgroundColor: color }]}> 
          <View style={styles.headerTop}>
            <TouchableOpacity style={styles.headerIconButton} onPress={() => navigation.goBack()}><Feather name="arrow-left" size={22} color="#FFFFFF" /></TouchableOpacity>
            <TouchableOpacity style={styles.headerIconButton} onPress={() => navigation.navigate('EditTransaction', { id: transaction.id })}><Feather name="edit-2" size={20} color="#FFFFFF" /></TouchableOpacity>
          </View>
          <View style={styles.typeIconCircle}>
            <Feather name={transaction.type === 'income' ? 'arrow-up-right' : transaction.type === 'expense' ? 'arrow-down-left' : 'repeat'} size={30} color={color} />
          </View>
          <Text style={styles.amount}>{sign}{formatCurrency(transaction.amount)}</Text>
          <Text style={styles.typeLabel}>{transaction.type}</Text>
        </View>

        <View style={styles.card}>
          <DetailRow icon="file-text" label="Description" value={transaction.description || 'No description'} />
          <DetailRow icon="tag" label="Category" value={String(transaction.category_name || 'Uncategorized')} />
          <DetailRow icon="credit-card" label="Account" value={String(transaction.account_name || 'Account')} />
          <DetailRow icon="calendar" label="Date" value={safeFormat(transaction.date)} />
          {transaction.note ? <DetailRow icon="align-left" label="Note" value={String(transaction.note)} /> : null}
          {tags.length ? (
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}><Feather name="hash" size={18} color="#0F3460" /></View>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Tags</Text>
                <View style={styles.tagsRow}>{tags.map((tag) => <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>)}</View>
              </View>
            </View>
          ) : null}
          {transaction.recurring ? <DetailRow icon="refresh-cw" label="Recurring" value={`Every ${transaction.recurring_interval || 'month'}`} /> : null}
          <DetailRow icon="clock" label="Created" value={safeFormat(transaction.created_at, 'MMM d, yyyy h:mm a')} />
        </View>

        <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete}>
          <Feather name="trash-2" size={20} color="#E74C3C" />
          <Text style={styles.deleteText}>Delete Transaction</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: FeatherIconName; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIcon}><Feather name={icon} size={18} color="#0F3460" /></View>
      <View style={styles.detailContent}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FA' },
  missingText: { color: '#6C757D', fontWeight: '800' },
  content: { paddingBottom: 30 },
  header: { minHeight: 280, paddingTop: 50, paddingHorizontal: 20, alignItems: 'center' },
  headerTop: { position: 'absolute', top: 48, left: 18, right: 18, flexDirection: 'row', justifyContent: 'space-between' },
  headerIconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  typeIconCircle: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginTop: 44 },
  amount: { color: '#FFFFFF', fontSize: 42, fontWeight: '900', marginTop: 18, letterSpacing: 0 },
  typeLabel: { color: 'rgba(255,255,255,0.82)', fontSize: 15, fontWeight: '800', marginTop: 8, textTransform: 'capitalize' },
  card: { marginHorizontal: 20, marginTop: -28, borderRadius: 18, backgroundColor: '#FFFFFF', padding: 18, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  detailRow: { flexDirection: 'row', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F3F5' },
  detailIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#0F346014', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  detailContent: { flex: 1 },
  detailLabel: { color: '#6C757D', fontSize: 12, fontWeight: '800', marginBottom: 5 },
  detailValue: { color: '#1A1A2E', fontSize: 15, fontWeight: '800' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { borderRadius: 999, backgroundColor: '#E9456018', paddingHorizontal: 10, paddingVertical: 6 },
  tagText: { color: '#E94560', fontSize: 12, fontWeight: '900' },
  deleteButton: { height: 54, marginHorizontal: 20, marginTop: 22, borderRadius: 14, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E74C3C33' },
  deleteText: { color: '#E74C3C', fontSize: 15, fontWeight: '900', marginLeft: 8 },
});

