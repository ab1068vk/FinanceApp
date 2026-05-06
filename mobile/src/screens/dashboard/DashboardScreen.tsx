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
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { AccountCard } from '../../components/common/AccountCard';
import { BudgetProgressCard } from '../../components/common/BudgetProgressCard';
import { showToast } from '../../components/common/Toast';
import { TransactionListItem } from '../../components/common/TransactionListItem';
import { DashboardStackParamList } from '../../navigation';
import api from '../../services/api';
import { loadAppSettings } from '../../services/appSettings';
import { Transaction, fetchBudgets, transactionsActions } from '../../store';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { accountsActions, fetchAccounts } from '../../store/slices/accountsSlice';
import { useTheme } from '../../theme';
import { monthRange } from '../../utils/dateRanges';
import type { FeatherIconName } from '../../utils/icons';
import { buildNotifications } from '../../utils/notifications';

type Summary = {
  total_income: number;
  total_expense: number;
  net: number;
};

type TransactionsResponse = {
  data: Transaction[];
};

type Announcement = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

type Props = StackScreenProps<DashboardStackParamList, 'DashboardHome'>;

function formatCurrency(amount: number, compact = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: compact ? 0 : 2,
  }).format(amount || 0);
}

function greetingFor(name?: string) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = name?.split(' ')[0] || 'there';
  return `${greeting}, ${firstName} 👋`;
}

export default function DashboardScreen({ navigation }: Props) {
  const theme = useTheme();
  const rootNav = useNavigation<any>();
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const { accounts, selectedAccount, isLoading: accountsLoading } = useAppSelector((state) => state.accounts);
  const selectedAccountId = selectedAccount?.id;
  const transactions = useAppSelector((state) => state.transactions.transactions);
  const budgets = useAppSelector((state) => state.budgets.budgets);
  const [summary, setSummary] = useState<Summary>({ total_income: 0, total_expense: 0, net: 0 });
  const [monthlySummary, setMonthlySummary] = useState<Summary>({ total_income: 0, total_expense: 0, net: 0 });
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [budgetAlertsEnabled, setBudgetAlertsEnabled] = useState(true);

  const netWorth = useMemo(
    () => accounts.reduce((sum, account) => sum + Number(account.current_balance ?? account.balance ?? 0), 0),
    [accounts]
  );
  const monthlyChange = (() => {
    if (netWorth === 0 || monthlySummary.net === 0) return 0;
    const raw = (monthlySummary.net / Math.abs(netWorth)) * 100;
    return Math.max(-100, Math.min(100, raw));
  })();
  const visibleBudgets = budgets.slice(0, 3);
  const visibleTransactions = transactions.slice(0, 5);
  const visibleAnnouncements = announcements.filter((announcement) => !dismissedAnnouncements.has(announcement.id)).slice(0, 2);
  const alertCount = useMemo(() => {
    const notifications = buildNotifications(budgets, transactions, new Date(), visibleAnnouncements);
    return budgetAlertsEnabled ? notifications.length : notifications.filter((notification) => notification.kind !== 'budget').length;
  }, [budgetAlertsEnabled, budgets, transactions, visibleAnnouncements]);

  const loadDashboard = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    const { start, end } = monthRange();

    try {
      const [settings, accountResult, transactionsResponse, , monthlySummaryResponse, allTimeSummaryResponse, announcementsResponse] = await Promise.all([
        loadAppSettings(),
        dispatch(fetchAccounts()).unwrap(),
        api.get<TransactionsResponse>('/api/transactions', { params: { limit: 5, page: 1, start_date: start, end_date: end } }),
        dispatch(fetchBudgets()).unwrap(),
        api.get<Summary>('/api/transactions/summary', { params: { start_date: start, end_date: end } }),
        api.get<Summary>('/api/transactions/summary'),
        api.get<{ data: Announcement[] }>('/api/announcements'),
      ]);

      setBudgetAlertsEnabled(settings.budgetAlerts);
      dispatch(transactionsActions.setTransactions({ transactions: transactionsResponse.data.data }));
      setMonthlySummary(monthlySummaryResponse.data);
      setSummary(allTimeSummaryResponse.data);
      setAnnouncements(announcementsResponse.data.data || []);

      if (!selectedAccountId && accountResult.length > 0) {
        dispatch(accountsActions.setSelectedAccount(accountResult[0] || null));
      }
    } catch (error) {
      showToast({ type: 'error', text1: 'Dashboard refresh failed', text2: 'Please check your connection and try again.' });
    } finally {
      if (showRefresh) setRefreshing(false);
    }
  }, [dispatch, selectedAccountId]);

  useFocusEffect(
    useCallback(() => {
      loadDashboard();
    }, [loadDashboard])
  );

  async function dismissAnnouncement(id: string) {
    setDismissedAnnouncements((current) => new Set(current).add(id));
    try {
      await api.post(`/api/announcements/${id}/dismiss`);
    } catch {
      showToast({ type: 'error', text1: 'Announcement dismiss failed', text2: 'It may appear again after refresh.' });
    }
  }

  const onRefresh = () => loadDashboard(true);

  return (
    <View style={styles.root}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.highlight} colors={[theme.colors.highlight]} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.headerSection}>
          <SafeAreaView edges={['top']}>
            <View style={styles.topRow}>
              <View style={styles.greetingBlock}>
                <Text style={styles.greeting}>{greetingFor(user?.full_name)}</Text>
                <Text style={styles.greetingSubtext}>Here is your financial snapshot</Text>
              </View>
              <TouchableOpacity
                style={styles.bellButton}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('Notifications')}
              >
                <Feather name="bell" size={22} color="#FFFFFF" />
                {alertCount > 0 ? (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>{alertCount > 9 ? '9+' : alertCount}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            </View>

            <View style={styles.netWorthCard}>
              <Text style={styles.netWorthLabel}>Total Net Worth</Text>
              <Text style={styles.netWorthValue}>{formatCurrency(netWorth, true)}</Text>
              <View style={styles.changeRow}>
                <Feather name={monthlyChange >= 0 ? 'arrow-up-right' : 'arrow-down-right'} size={15} color={monthlyChange >= 0 ? theme.colors.success : theme.colors.danger} />
                <Text style={[styles.changeText, { color: monthlyChange >= 0 ? theme.colors.success : theme.colors.danger }]}>
                  {Math.abs(monthlyChange).toFixed(1)}% vs last month
                </Text>
              </View>
              <View style={styles.netWorthMetrics}>
                <View style={styles.netWorthMetric}>
                  <Text style={styles.metricLabel}>Income</Text>
                  <Text style={[styles.metricValue, { color: theme.colors.success }]}>{formatCurrency(summary.total_income, true)}</Text>
                </View>
                <View style={styles.metricDivider} />
                <View style={styles.netWorthMetric}>
                  <Text style={styles.metricLabel}>Expense</Text>
                  <Text style={[styles.metricValue, { color: theme.colors.danger }]}>{formatCurrency(summary.total_expense, true)}</Text>
                </View>
              </View>
            </View>
          </SafeAreaView>
        </View>

        <View style={styles.bodySection}>
          <View style={styles.accountsBridge}>
            {accountsLoading && accounts.length === 0 ? (
              <View style={styles.loadingCard}><ActivityIndicator color={theme.colors.highlight} /></View>
            ) : accounts.length === 0 ? (
              <EmptyState
                icon="credit-card"
                title="Add your first account"
                buttonLabel="Add Account"
                onPress={() => rootNav.navigate('Accounts', { screen: 'AddAccount' })}
              />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accountsScroll}>
                {accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    selected={selectedAccount?.id === account.id}
                    onPress={() => {
                      dispatch(accountsActions.setSelectedAccount(account));
                      rootNav.navigate('Accounts', { screen: 'AccountDetail', params: { id: account.id } });
                    }}
                  />
                ))}
                <AccountCard addCard onPress={() => rootNav.navigate('Accounts', { screen: 'AddAccount' })} />
              </ScrollView>
            )}
          </View>

          <View style={styles.contentBlock}>
            {visibleAnnouncements.map((announcement) => (
              <View key={announcement.id} style={styles.announcementCard}>
                <View style={styles.announcementIcon}>
                  <Feather name="volume-2" size={18} color="#E94560" />
                </View>
                <View style={styles.announcementCopy}>
                  <Text style={styles.announcementTitle}>{announcement.title}</Text>
                  <Text style={styles.announcementBody}>{announcement.body}</Text>
                </View>
                <TouchableOpacity
                  style={styles.announcementClose}
                  onPress={() => dismissAnnouncement(announcement.id)}
                  activeOpacity={0.75}
                >
                  <Feather name="x" size={18} color="#6C757D" />
                </TouchableOpacity>
              </View>
            ))}

            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.quickActionsRow}>
              <QuickAction
                icon="minus-circle"
                label="Add Expense"
                color={theme.colors.danger}
                onPress={() => rootNav.navigate('Transactions', { screen: 'AddTransaction', params: { defaultType: 'expense' } })}
              />
              <QuickAction
                icon="plus-circle"
                label="Add Income"
                color={theme.colors.success}
                onPress={() => rootNav.navigate('Transactions', { screen: 'AddTransaction', params: { defaultType: 'income' } })}
              />
              <QuickAction
                icon="repeat"
                label="Transfer"
                color={theme.colors.accent}
                onPress={() => rootNav.navigate('Transactions', { screen: 'AddTransaction', params: { defaultType: 'transfer' } })}
              />
              <QuickAction
                icon="bar-chart-2"
                label="Reports"
                color={theme.colors.warning}
                onPress={() => rootNav.navigate('Reports')}
              />
            </View>

            <TouchableOpacity style={styles.overviewCard} activeOpacity={0.84} onPress={() => navigation.navigate('Overview')}>
              <View style={styles.overviewIcon}>
                <Feather name="activity" size={22} color="#E94560" />
              </View>
              <View style={styles.overviewCopy}>
                <Text style={styles.overviewTitle}>Open financial overview</Text>
                <Text style={styles.overviewText}>Account mix, savings rate, spending categories, budget health, and recent activity.</Text>
              </View>
              <Feather name="chevron-right" size={20} color="#6C757D" />
            </TouchableOpacity>

            <SectionHeader title="Recent Transactions" link="See All" onPress={() => rootNav.navigate('Transactions', { screen: 'TransactionsHome' })} />
            {visibleTransactions.length === 0 ? (
              <EmptyState
                icon="file-plus"
                title="Record your first transaction"
                buttonLabel="Add Transaction"
                compact
                onPress={() => rootNav.navigate('Transactions', { screen: 'AddTransaction' })}
              />
            ) : (
              visibleTransactions.map((transaction) => (
                <TransactionListItem
                  key={transaction.id}
                  transaction={transaction}
                  onPress={() => rootNav.navigate('Transactions', { screen: 'TransactionDetail', params: { id: transaction.id } })}
                />
              ))
            )}

            <SectionHeader title="Budget Overview" link="See All" onPress={() => rootNav.navigate('Budgets')} />
            {visibleBudgets.length === 0 ? (
              <View style={styles.mutedPanel}>
                <Feather name="pie-chart" size={28} color={theme.colors.text.light} />
                <Text style={styles.mutedText}>Budgets will appear here once you create them.</Text>
              </View>
            ) : (
              visibleBudgets.map((budget) => <BudgetProgressCard key={budget.id} budget={budget} />)
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function SectionHeader({ title, link, onPress }: { title: string; link: string; onPress?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <TouchableOpacity activeOpacity={0.75} onPress={onPress}>
        <Text style={styles.seeAll}>{link}</Text>
      </TouchableOpacity>
    </View>
  );
}

function QuickAction({ icon, label, color, onPress }: { icon: FeatherIconName; label: string; color: string; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.quickAction} onPress={onPress} activeOpacity={0.82}>
      <View style={[styles.quickIconCircle, { backgroundColor: `${color}18` }]}> 
        <Feather name={icon} size={22} color={color} />
      </View>
      <Text style={styles.quickLabel} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

function EmptyState({ icon, title, buttonLabel, compact = false, onPress }: { icon: FeatherIconName; title: string; buttonLabel: string; compact?: boolean; onPress?: () => void }) {
  return (
    <View style={[styles.emptyState, compact && styles.emptyCompact]}>
      <View style={styles.emptyIllustration}>
        <Feather name={icon} size={34} color="#ADB5BD" />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <TouchableOpacity style={styles.emptyButton} activeOpacity={0.82} onPress={onPress}>
        <Text style={styles.emptyButtonText}>{buttonLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollContent: { paddingBottom: 32 },
  headerSection: {
    minHeight: 330,
    backgroundColor: '#1A1A2E',
    paddingHorizontal: 24,
    paddingBottom: 70,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18 },
  greetingBlock: { flex: 1, paddingRight: 12 },
  greeting: { color: '#FFFFFF', fontSize: 21, fontWeight: '800', letterSpacing: 0 },
  greetingSubtext: { color: '#ADB5BD', fontSize: 13, marginTop: 6 },
  bellButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  bellBadge: {
    position: 'absolute',
    top: -3,
    right: -2,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: '#E94560',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: '#1A1A2E',
  },
  bellBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  netWorthCard: { alignItems: 'center', marginTop: 34 },
  netWorthLabel: { color: '#ADB5BD', fontSize: 14, fontWeight: '700' },
  netWorthValue: { color: '#FFFFFF', fontSize: 44, fontWeight: '900', marginTop: 8, letterSpacing: 0 },
  changeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  changeText: { fontSize: 13, fontWeight: '800', marginLeft: 5 },
  netWorthMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
    marginTop: 22,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  netWorthMetric: { flex: 1, alignItems: 'center', minWidth: 0 },
  metricLabel: { color: '#ADB5BD', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  metricValue: { fontSize: 18, fontWeight: '900', marginTop: 5, letterSpacing: 0 },
  metricDivider: { width: 1, height: 38, backgroundColor: 'rgba(255,255,255,0.16)' },
  bodySection: { backgroundColor: '#F8F9FA', minHeight: 520 },
  accountsBridge: { marginTop: -50, minHeight: 118 },
  accountsScroll: { paddingHorizontal: 24, paddingBottom: 18 },
  loadingCard: {
    marginHorizontal: 24,
    height: 100,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentBlock: { paddingHorizontal: 24, paddingTop: 8 },
  announcementCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#E94560',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  announcementIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#FDECEC', alignItems: 'center', justifyContent: 'center' },
  announcementCopy: { flex: 1, minWidth: 0 },
  announcementTitle: { color: '#1A1A2E', fontSize: 14, fontWeight: '900' },
  announcementBody: { color: '#6C757D', fontSize: 13, lineHeight: 18, marginTop: 4 },
  announcementClose: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 },
  sectionTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900', letterSpacing: 0 },
  seeAll: { color: '#E94560', fontSize: 13, fontWeight: '800' },
  quickActionsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  quickAction: { width: '23%', alignItems: 'center' },
  quickIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  quickLabel: { color: '#1A1A2E', fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 8, minHeight: 32 },
  overviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginTop: 22,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  overviewIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#FDECEC', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  overviewCopy: { flex: 1, minWidth: 0 },
  overviewTitle: { color: '#1A1A2E', fontSize: 15, fontWeight: '900' },
  overviewText: { color: '#6C757D', fontSize: 12, lineHeight: 17, marginTop: 4, fontWeight: '700' },
  emptyState: {
    marginHorizontal: 24,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    padding: 22,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  emptyCompact: { marginHorizontal: 0, marginBottom: 12 },
  emptyIllustration: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { color: '#1A1A2E', fontSize: 16, fontWeight: '800', marginBottom: 14, textAlign: 'center' },
  emptyButton: { borderRadius: 12, backgroundColor: '#E94560', paddingHorizontal: 18, paddingVertical: 12 },
  emptyButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  mutedPanel: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 22, alignItems: 'center' },
  mutedText: { color: '#6C757D', fontSize: 14, fontWeight: '700', marginTop: 10, textAlign: 'center' },
});
