import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Modal from 'react-native-modal';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import { TransactionListItem } from '../../components/common/TransactionListItem';
import { showToast } from '../../components/common/Toast';
import { AccountsStackParamList } from '../../navigation';
import api from '../../services/api';
import { Account, accountsActions, deleteAccount, DeleteAccountAction, fetchAccounts } from '../../store/slices/accountsSlice';
import { Transaction } from '../../store/slices/transactionsSlice';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { featherIconName } from '../../utils/icons';

type Props = StackScreenProps<AccountsStackParamList, 'AccountDetail'>;
type AccountDetail = Account & {
  recent_transactions?: Transaction[];
};
type TransactionsResponse = {
  data: Transaction[];
};

function formatCurrency(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount || 0);
}

function formatDate(value?: string) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString();
}

function transactionDelta(transaction: Transaction) {
  const amount = Number(transaction.amount || 0);
  if (transaction.type === 'income') return amount;
  if (transaction.type === 'expense') return -amount;
  if (transaction.transfer_direction) return transaction.transfer_direction === 'destination' ? amount : -amount;

  try {
    const tags = typeof transaction.tags === 'string' ? JSON.parse(transaction.tags) : transaction.tags;
    return tags?.transfer_direction === 'destination' ? amount : -amount;
  } catch {
    return -amount;
  }
}

export default function AccountDetailScreen({ navigation, route }: Props) {
  const dispatch = useAppDispatch();
  const cachedAccount = useAppSelector((state) => state.accounts.accounts.find((account) => account.id === route.params.id));
  const [account, setAccount] = useState<AccountDetail | null>(cachedAccount || null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [deletingAction, setDeletingAction] = useState<DeleteAccountAction | null>(null);

  const loadAccount = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [detailResponse, transactionResponse] = await Promise.all([
        api.get<AccountDetail>(`/api/accounts/${route.params.id}`),
        api.get<TransactionsResponse>('/api/transactions', { params: { account_id: route.params.id, page: 1, limit: 20 } }),
        dispatch(fetchAccounts()).unwrap(),
      ]);
      setAccount(detailResponse.data);
      setTransactions(transactionResponse.data.data);
      dispatch(accountsActions.setSelectedAccount(detailResponse.data));
    } catch {
      showToast({ type: 'error', text1: 'Account failed to load', text2: 'Pull to refresh and try again.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dispatch, route.params.id]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  const history = useMemo(() => {
    const currentBalance = Number(account?.current_balance ?? account?.balance ?? 0);
    let running = currentBalance;
    return transactions.slice(0, 8).map((transaction) => {
      const after = running;
      const delta = transactionDelta(transaction);
      running -= delta;
      return { transaction, delta, after };
    });
  }, [account?.balance, account?.current_balance, transactions]);

  const balance = Number(account?.current_balance ?? account?.balance ?? 0);
  const isNegative = balance < 0;
  const accent = account?.color || '#0F3460';

  const confirmDelete = async (transactionAction: DeleteAccountAction) => {
    if (!account) return;

    try {
      setDeletingAction(transactionAction);
      await dispatch(deleteAccount({ id: account.id, transactionAction })).unwrap();
      showToast({ type: 'success', text1: 'Account deleted' });
      setConfirmDeleteVisible(false);
      navigation.navigate('AccountsHome');
    } catch (error) {
      showToast({ type: 'error', text1: 'Unable to delete account', text2: typeof error === 'string' ? error : 'Please try again.' });
    } finally {
      setDeletingAction(null);
    }
  };

  if (loading && !account) {
    return <View style={styles.centered}><ActivityIndicator color="#E94560" /></View>;
  }

  if (!account) {
    return (
      <View style={styles.centered}>
        <Feather name="credit-card" size={40} color="#ADB5BD" />
        <Text style={styles.emptyTitle}>Account unavailable</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => loadAccount()}><Text style={styles.retryText}>Try Again</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadAccount(true)} tintColor="#E94560" colors={['#E94560']} />}
      >
        <View style={[styles.hero, { backgroundColor: accent }]}>
          <View style={styles.heroTop}>
            <View style={styles.iconCircle}>
              <Feather name={featherIconName(account.icon, 'credit-card')} size={28} color={accent} />
            </View>
            <TouchableOpacity style={styles.heroButton} onPress={() => navigation.navigate('EditAccount', { id: account.id })}>
              <Feather name="edit-2" size={19} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={styles.accountName}>{account.name}</Text>
          <Text style={styles.accountType}>{account.type} - {account.currency}</Text>
          <View style={styles.balanceRow}>
            {isNegative ? <Feather name="alert-triangle" size={22} color="#FFFFFF" /> : null}
            <Text style={styles.balance}>{formatCurrency(balance, account.currency)}</Text>
          </View>
          {isNegative ? <Text style={styles.negativeNotice}>Negative balance</Text> : null}
        </View>

        <View style={styles.statsRow}>
          <Stat label="Starting" value={formatCurrency(Number(account.balance || 0), account.currency)} />
          <Stat label="Created" value={formatDate(account.created_at)} />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Balance History</Text>
        </View>
        <View style={styles.panel}>
          {history.length ? history.map(({ transaction, delta, after }) => (
            <View key={transaction.id} style={styles.historyRow}>
              <View style={[styles.deltaDot, { backgroundColor: delta >= 0 ? '#27AE60' : '#E74C3C' }]}>
                <Feather name={delta >= 0 ? 'arrow-up' : 'arrow-down'} size={14} color="#FFFFFF" />
              </View>
              <View style={styles.historyCenter}>
                <Text style={styles.historyTitle} numberOfLines={1}>{transaction.description || transaction.type}</Text>
                <Text style={styles.historyMeta}>{formatDate(transaction.date)}</Text>
              </View>
              <View style={styles.historyRight}>
                <Text style={[styles.deltaText, { color: delta >= 0 ? '#27AE60' : '#E74C3C' }]}>{formatCurrency(delta, account.currency)}</Text>
                <Text style={styles.afterText}>{formatCurrency(after, account.currency)}</Text>
              </View>
            </View>
          )) : (
            <Text style={styles.emptyText}>Balance changes will appear after transactions are added.</Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Transactions' as never)}>
            <Text style={styles.linkText}>See All</Text>
          </TouchableOpacity>
        </View>
        {transactions.length ? (
          transactions.slice(0, 5).map((transaction) => <TransactionListItem key={transaction.id} transaction={transaction} />)
        ) : (
          <View style={styles.emptyPanel}>
            <Feather name="file-text" size={26} color="#ADB5BD" />
            <Text style={styles.emptyText}>No transactions for this account yet.</Text>
          </View>
        )}

        <TouchableOpacity style={styles.deleteButton} onPress={() => setConfirmDeleteVisible(true)}>
          <Feather name="trash-2" size={20} color="#E74C3C" />
          <Text style={styles.deleteText}>Delete Account</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal isVisible={confirmDeleteVisible} onBackdropPress={() => setConfirmDeleteVisible(false)} style={styles.modal}>
        <View style={styles.modalCard}>
          <View style={styles.modalIcon}><Feather name="alert-triangle" size={24} color="#E74C3C" /></View>
          <Text style={styles.modalTitle}>Delete account?</Text>
          <Text style={styles.modalBody}>Choose what should happen to transactions linked to this account.</Text>
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setConfirmDeleteVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cashButton} onPress={() => confirmDelete('cash')} disabled={Boolean(deletingAction)}>
              {deletingAction === 'cash' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.cashButtonText}>Move to Cash</Text>}
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.deleteTransactionsButton} onPress={() => confirmDelete('delete')} disabled={Boolean(deletingAction)}>
            {deletingAction === 'delete' ? <ActivityIndicator color="#E74C3C" /> : (
              <>
                <Feather name="trash-2" size={18} color="#E74C3C" />
                <Text style={styles.deleteTransactionsText}>Delete transactions too</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, backgroundColor: '#F8F9FA', alignItems: 'center', justifyContent: 'center', padding: 24 },
  hero: { minHeight: 214, borderRadius: 18, padding: 20, justifyContent: 'space-between' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconCircle: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  heroButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  accountName: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', letterSpacing: 0 },
  accountType: { color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: '800', textTransform: 'capitalize' },
  balance: { color: '#FFFFFF', fontSize: 38, fontWeight: '900', letterSpacing: 0 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  negativeNotice: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  stat: { flex: 1, borderRadius: 14, backgroundColor: '#FFFFFF', padding: 14 },
  statLabel: { color: '#6C757D', fontSize: 12, fontWeight: '800' },
  statValue: { color: '#1A1A2E', fontSize: 16, fontWeight: '900', marginTop: 7 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 },
  sectionTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900' },
  linkText: { color: '#E94560', fontSize: 13, fontWeight: '900' },
  panel: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 14 },
  historyRow: { flexDirection: 'row', alignItems: 'center', minHeight: 62, borderBottomWidth: 1, borderBottomColor: '#F1F3F5' },
  deltaDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  historyCenter: { flex: 1, minWidth: 0 },
  historyTitle: { color: '#1A1A2E', fontSize: 14, fontWeight: '900' },
  historyMeta: { color: '#6C757D', fontSize: 12, fontWeight: '700', marginTop: 4 },
  historyRight: { alignItems: 'flex-end', marginLeft: 10 },
  deltaText: { fontSize: 13, fontWeight: '900' },
  afterText: { color: '#6C757D', fontSize: 12, fontWeight: '800', marginTop: 4 },
  emptyPanel: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 24, alignItems: 'center' },
  emptyTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900', marginTop: 12 },
  emptyText: { color: '#6C757D', fontSize: 13, fontWeight: '700', textAlign: 'center', lineHeight: 19 },
  retryButton: { marginTop: 16, borderRadius: 12, backgroundColor: '#E94560', paddingHorizontal: 18, paddingVertical: 12 },
  retryText: { color: '#FFFFFF', fontWeight: '900' },
  deleteButton: { height: 54, borderRadius: 14, borderWidth: 1.5, borderColor: '#E74C3C33', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 26 },
  deleteText: { color: '#E74C3C', fontSize: 15, fontWeight: '900', marginLeft: 8 },
  modal: { margin: 22, justifyContent: 'center' },
  modalCard: { borderRadius: 18, backgroundColor: '#FFFFFF', padding: 22, alignItems: 'center' },
  modalIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#FDECEC', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  modalTitle: { color: '#1A1A2E', fontSize: 20, fontWeight: '900' },
  modalBody: { color: '#6C757D', fontSize: 14, fontWeight: '700', lineHeight: 20, textAlign: 'center', marginTop: 8 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20, alignSelf: 'stretch' },
  cancelButton: { flex: 1, height: 48, borderRadius: 12, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: '#1A1A2E', fontWeight: '900' },
  cashButton: { flex: 1, height: 48, borderRadius: 12, backgroundColor: '#0F3460', alignItems: 'center', justifyContent: 'center' },
  cashButtonText: { color: '#FFFFFF', fontWeight: '900' },
  deleteTransactionsButton: { height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: '#E74C3C33', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch', marginTop: 10 },
  deleteTransactionsText: { color: '#E74C3C', fontWeight: '900' },
});
