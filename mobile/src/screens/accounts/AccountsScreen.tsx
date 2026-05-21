import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { AccountCard } from '../../components/common/AccountCard';
import { AccountsStackParamList } from '../../navigation';
import { accountsActions, fetchAccounts } from '../../store/slices/accountsSlice';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { useTheme } from '../../theme';
import { formatAccountBalanceSummary, groupAccountBalancesByCurrency, hasMixedCurrencies } from '../../utils/accountBalances';

type Props = StackScreenProps<AccountsStackParamList, 'AccountsHome'>;

export default function AccountsScreen({ navigation }: Props) {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const { accounts, isLoading } = useAppSelector((state) => state.accounts);
  const [localError, setLocalError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      setLocalError(null);
      await dispatch(fetchAccounts()).unwrap();
    } catch (error) {
      setLocalError(typeof error === 'string' ? error : 'Unable to load accounts.');
    }
  }, [dispatch]);

  useFocusEffect(
    useCallback(() => {
      loadAccounts();
    }, [loadAccounts]),
  );

  const balanceGroups = useMemo(() => groupAccountBalancesByCurrency(accounts), [accounts]);
  const balanceSummary = useMemo(
    () => formatAccountBalanceSummary(balanceGroups, { maximumFractionDigits: 0 }),
    [balanceGroups],
  );
  const mixedCurrencies = hasMixedCurrencies(balanceGroups);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.label}>Total balance</Text>
          <Text style={styles.total}>{balanceSummary}</Text>
          {mixedCurrencies ? <Text style={styles.totalNote}>Multiple currencies shown separately</Text> : null}
        </View>
        <TouchableOpacity style={styles.headerButton} onPress={() => navigation.navigate('AddAccount')}>
          <Feather name="plus" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {isLoading && accounts.length === 0 ? (
        <View style={styles.centered}><ActivityIndicator color={theme.colors.highlight} /></View>
      ) : (
        <>
        {localError ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={18} color="#E74C3C" />
            <Text style={styles.errorText}>{localError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={loadAccounts}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <FlatList
          data={accounts}
          keyExtractor={(account) => account.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadAccounts} tintColor={theme.colors.highlight} colors={[theme.colors.highlight]} />}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Feather name="credit-card" size={34} color="#ADB5BD" /></View>
              <Text style={styles.emptyTitle}>No accounts yet</Text>
              <Text style={styles.emptyText}>Add checking, savings, credit, investment, or cash accounts.</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => navigation.navigate('AddAccount')}>
                <Text style={styles.emptyButtonText}>Add Account</Text>
              </TouchableOpacity>
            </View>
          )}
          renderItem={({ item }) => (
            <AccountCard
              account={item}
              wide
              onPress={() => {
                dispatch(accountsActions.setSelectedAccount(item));
                navigation.navigate('AccountDetail', { id: item.id });
              }}
            />
          )}
        />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  header: {
    minHeight: 132,
    backgroundColor: '#1A1A2E',
    padding: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: { color: '#ADB5BD', fontSize: 13, fontWeight: '800' },
  total: { color: '#FFFFFF', fontSize: 30, lineHeight: 38, fontWeight: '900', marginTop: 8, letterSpacing: 0 },
  totalNote: { color: '#ADB5BD', fontSize: 12, fontWeight: '700', marginTop: 4 },
  headerButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#FDECEC', padding: 12, marginHorizontal: 18, marginTop: 14 },
  errorText: { color: '#E74C3C', fontSize: 13, fontWeight: '800', flex: 1 },
  retryButton: { borderRadius: 10, backgroundColor: '#E74C3C', paddingHorizontal: 12, paddingVertical: 8 },
  retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  list: { padding: 18, paddingBottom: 110 },
  empty: { alignItems: 'center', padding: 34, marginTop: 44, borderRadius: 16, backgroundColor: '#FFFFFF' },
  emptyIcon: { width: 78, height: 78, borderRadius: 39, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900' },
  emptyText: { color: '#6C757D', fontSize: 13, fontWeight: '700', marginTop: 8, textAlign: 'center', lineHeight: 19 },
  emptyButton: { marginTop: 18, height: 46, borderRadius: 12, backgroundColor: '#E94560', paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  emptyButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
