import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import { fetchBudgets } from '../../store';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchAccounts } from '../../store/slices/accountsSlice';
import { fetchTransactions } from '../../store/slices/transactionsSlice';
import { logoutUser } from '../../store/slices/authSlice';
import { ProfileStackParamList } from '../../navigation';
import type { FeatherIconName } from '../../utils/icons';

type Props = StackScreenProps<ProfileStackParamList, 'ProfileHome'>;

function initials(name?: string) {
  const parts = (name || 'Finance User').trim().split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'FU';
}

export default function ProfileScreen({ navigation, route }: Props) {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const accounts = useAppSelector((state) => state.accounts.accounts);
  const transactions = useAppSelector((state) => state.transactions.transactions);
  const budgets = useAppSelector((state) => state.budgets.budgets);
  const [refreshing, setRefreshing] = useState(false);
  const totalBalance = useMemo(() => accounts.reduce((sum, account) => sum + Number(account.current_balance ?? account.balance ?? 0), 0), [accounts]);

  const loadProfileData = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        dispatch(fetchAccounts()).unwrap(),
        dispatch(fetchTransactions({ page: 1, limit: 20 })).unwrap(),
        dispatch(fetchBudgets()).unwrap(),
      ]);
    } catch {
      showToast({ type: 'error', text1: 'Profile refresh failed' });
    } finally {
      setRefreshing(false);
    }
  }, [dispatch]);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  useEffect(() => {
    if (!route.params?.verifyNewEmailToken) return;
    showToast({ type: 'success', text1: 'New email link opened', text2: 'Confirm the change from your profile details.' });
  }, [route.params?.verifyNewEmailToken]);

  const signOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to access FinanceApp.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => dispatch(logoutUser()) },
    ]);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadProfileData} tintColor="#E94560" colors={['#E94560']} />}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={() => navigation.navigate('EditProfile')}>
            <Feather name="edit-2" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.headerButton, styles.settingsButton]} onPress={() => navigation.navigate('Settings')}>
            <Feather name="settings" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <LinearGradient colors={[user?.avatar_color || '#0F3460', '#16213E']} style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(user?.full_name)}</Text>
          </LinearGradient>
          <Text style={styles.fullName}>{user?.full_name || 'Finance User'}</Text>
          <Text style={styles.email} numberOfLines={1}>{user?.email || 'user@financeapp.local'}</Text>
        </View>

        {refreshing ? <ActivityIndicator color="#E94560" style={styles.loader} /> : null}

        <View style={styles.statsRow}>
          <StatCard label="Accounts" value={accounts.length} />
          <StatCard label="Transactions" value={transactions.length} />
          <StatCard label="Budgets" value={budgets.length} />
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Balance</Text>
          <Text style={styles.summaryValue}>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalBalance)}</Text>
        </View>

        <View style={styles.actions}>
          <ProfileAction icon="user" label="Edit Profile" onPress={() => navigation.navigate('EditProfile')} />
          <ProfileAction icon="settings" label="Settings" onPress={() => navigation.navigate('Settings')} />
          <ProfileAction icon="tag" label="Categories" onPress={() => navigation.navigate('Categories')} />
          <ProfileAction icon="lock" label="Change Password" onPress={() => navigation.navigate('ChangePassword')} />
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={signOut}>
          <Feather name="log-out" size={20} color="#E74C3C" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return <View style={styles.statCard}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function ProfileAction({ icon, label, onPress }: { icon: FeatherIconName; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress}>
      <View style={styles.actionIcon}><Feather name={icon} size={20} color="#0F3460" /></View>
      <Text style={styles.actionLabel}>{label}</Text>
      <Feather name="chevron-right" size={20} color="#ADB5BD" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { paddingBottom: 34 },
  header: { minHeight: 244, backgroundColor: '#1A1A2E', alignItems: 'center', justifyContent: 'center', paddingTop: 30, paddingHorizontal: 24, paddingBottom: 28 },
  headerButton: { position: 'absolute', top: 52, right: 22, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  settingsButton: { right: 74 },
  avatar: { width: 82, height: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.24)' },
  avatarText: { color: '#FFFFFF', fontSize: 30, fontWeight: '900' },
  fullName: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', marginTop: 14, textAlign: 'center' },
  email: { color: '#ADB5BD', fontSize: 14, marginTop: 6, maxWidth: '100%' },
  loader: { marginTop: 14 },
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 18 },
  statCard: { flex: 1, minHeight: 78, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: 10, shadowColor: '#000000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  statValue: { color: '#1A1A2E', fontSize: 22, fontWeight: '900' },
  statLabel: { color: '#6C757D', fontSize: 12, fontWeight: '800', marginTop: 4 },
  summaryCard: { marginHorizontal: 20, marginTop: 18, borderRadius: 16, backgroundColor: '#FFFFFF', padding: 18 },
  summaryLabel: { color: '#6C757D', fontSize: 13, fontWeight: '900' },
  summaryValue: { color: '#1A1A2E', fontSize: 30, fontWeight: '900', marginTop: 8 },
  actions: { marginHorizontal: 20, marginTop: 22, borderRadius: 16, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  actionRow: { minHeight: 58, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F1F3F5' },
  actionIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0F346014', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  actionLabel: { color: '#1A1A2E', fontSize: 15, fontWeight: '800', flex: 1 },
  logoutButton: { height: 54, borderRadius: 14, borderWidth: 1.5, borderColor: '#E74C3C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginHorizontal: 20, marginTop: 28 },
  logoutText: { color: '#E74C3C', fontSize: 16, fontWeight: '900', marginLeft: 8 },
});
