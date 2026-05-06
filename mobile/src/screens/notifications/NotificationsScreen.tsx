import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import api from '../../services/api';
import { loadAppSettings } from '../../services/appSettings';
import { showToast } from '../../components/common/Toast';
import { DashboardStackParamList } from '../../navigation';
import { fetchBudgets, Transaction } from '../../store';
import { useAppDispatch } from '../../store/hooks';
import { useTheme } from '../../theme';
import { AppNotification, buildNotifications, NotificationKind, NotificationSeverity } from '../../utils/notifications';
import type { FeatherIconName } from '../../utils/icons';

type Props = StackScreenProps<DashboardStackParamList, 'Notifications'>;
type TransactionsResponse = { data: Transaction[] };
type Announcement = { id: string; title: string; body: string; created_at: string };

const filters: Array<{ key: 'all' | NotificationKind; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'announcement', label: 'Admin' },
  { key: 'budget', label: 'Budgets' },
  { key: 'large-transaction', label: 'Large' },
  { key: 'recurring', label: 'Recurring' },
];

function iconFor(kind: NotificationKind): FeatherIconName {
  if (kind === 'announcement') return 'volume-2';
  if (kind === 'budget') return 'alert-triangle';
  if (kind === 'large-transaction') return 'dollar-sign';
  return 'repeat';
}

function colorFor(severity: NotificationSeverity) {
  if (severity === 'critical') return '#E74C3C';
  if (severity === 'warning') return '#F39C12';
  return '#0F3460';
}

export default function NotificationsScreen({ navigation }: Props) {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const rootNav = useNavigation<any>();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<'all' | NotificationKind>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [settings, budgets, transactionsResponse, announcementsResponse] = await Promise.all([
        loadAppSettings(),
        dispatch(fetchBudgets()).unwrap(),
        api.get<TransactionsResponse>('/api/transactions', { params: { page: 1, limit: 100 } }),
        api.get<{ data: Announcement[] }>('/api/announcements'),
      ]);

      const nextNotifications = buildNotifications(budgets, transactionsResponse.data.data, new Date(), announcementsResponse.data.data || []);
      setNotifications(settings.budgetAlerts ? nextNotifications : nextNotifications.filter((notification) => notification.kind !== 'budget'));
    } catch {
      setNotifications([]);
      setError('Unable to load notifications. Pull to refresh and try again.');
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const visibleNotifications = useMemo(
    () => notifications.filter((item) => selectedFilter === 'all' || item.kind === selectedFilter),
    [notifications, selectedFilter]
  );

  const counts = useMemo(() => ({
    all: notifications.length,
    announcement: notifications.filter((item) => item.kind === 'announcement').length,
    budget: notifications.filter((item) => item.kind === 'budget').length,
    'large-transaction': notifications.filter((item) => item.kind === 'large-transaction').length,
    recurring: notifications.filter((item) => item.kind === 'recurring').length,
  }), [notifications]);

  const openNotification = async (notification: AppNotification) => {
    if (!notification.action) return;
    if (notification.action.type === 'announcement') {
      setNotifications((current) => current.filter((item) => item.id !== notification.id));
      try {
        await api.post(`/api/announcements/${notification.action.id}/dismiss`);
      } catch {
        showToast({ type: 'error', text1: 'Announcement dismiss failed', text2: 'Pull to refresh and try again.' });
      }
      return;
    }
    if (notification.action.type === 'budget') {
      rootNav.navigate('Budgets', { screen: 'BudgetDetail', params: { id: notification.action.id } });
      return;
    }

    rootNav.navigate('Transactions', { screen: 'TransactionDetail', params: { id: notification.action.id } });
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.78}>
            <Feather name="arrow-left" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerTitleBlock}>
            <Text style={styles.headerTitle}>Notifications</Text>
            <Text style={styles.headerSubtitle}>{notifications.length} active alerts</Text>
          </View>
          <View style={styles.headerIcon}>
            <Feather name="bell" size={22} color="#FFFFFF" />
          </View>
        </View>

        <View style={styles.summaryRow}>
          <SummaryPill label="Budgets" value={counts.budget} color={theme.colors.danger} />
          <SummaryPill label="Large" value={counts['large-transaction']} color={theme.colors.accent} />
          <SummaryPill label="Admin" value={counts.announcement} color={theme.colors.highlight} />
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadNotifications} tintColor={theme.colors.highlight} colors={[theme.colors.highlight]} />}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {filters.map((filter) => {
            const active = selectedFilter === filter.key;
            return (
              <TouchableOpacity key={filter.key} style={[styles.filterPill, active && styles.filterPillActive]} onPress={() => setSelectedFilter(filter.key)} activeOpacity={0.78}>
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{filter.label}</Text>
                <Text style={[styles.filterCount, active && styles.filterTextActive]}>{counts[filter.key]}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {error ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={18} color={theme.colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading && notifications.length === 0 ? (
          <View style={styles.loadingPanel}>
            <ActivityIndicator color={theme.colors.highlight} />
          </View>
        ) : visibleNotifications.length === 0 ? (
          <EmptyNotifications filtered={selectedFilter !== 'all'} />
        ) : (
          visibleNotifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onPress={() => { void openNotification(notification); }}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function SummaryPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.summaryPill}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function NotificationCard({ notification, onPress }: { notification: AppNotification; onPress: () => void }) {
  const color = colorFor(notification.severity);

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.82} onPress={onPress}>
      <View style={[styles.cardIcon, { backgroundColor: `${color}18` }]}>
        <Feather name={iconFor(notification.kind)} size={20} color={color} />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle} numberOfLines={1}>{notification.title}</Text>
          <View style={[styles.severityDot, { backgroundColor: color }]} />
        </View>
        <Text style={styles.cardMessage}>{notification.message}</Text>
        <Text style={styles.cardDetail}>{notification.detail}</Text>
      </View>
      <Feather name="chevron-right" size={20} color="#ADB5BD" />
    </TouchableOpacity>
  );
}

function EmptyNotifications({ filtered }: { filtered: boolean }) {
  return (
    <View style={styles.emptyPanel}>
      <View style={styles.emptyIcon}>
        <Feather name="check-circle" size={34} color="#27AE60" />
      </View>
      <Text style={styles.emptyTitle}>{filtered ? 'No alerts in this view' : 'All clear'}</Text>
      <Text style={styles.emptyText}>{filtered ? 'Try another notification type.' : 'Budget, large transaction, and recurring reminders will appear here.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { backgroundColor: '#1A1A2E', paddingHorizontal: 24, paddingBottom: 24 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18 },
  headerTitleBlock: { flex: 1, minWidth: 0 },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginRight: 12,
  },
  headerTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', letterSpacing: 0 },
  headerSubtitle: { color: '#ADB5BD', fontSize: 13, fontWeight: '700', marginTop: 6 },
  headerIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  summaryRow: { flexDirection: 'row', gap: 10, marginTop: 22 },
  summaryPill: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 12 },
  summaryValue: { fontSize: 22, fontWeight: '900' },
  summaryLabel: { color: '#DEE2E6', fontSize: 12, fontWeight: '800', marginTop: 4 },
  content: { padding: 24, paddingBottom: 36 },
  filterRow: { gap: 10, paddingBottom: 14 },
  filterPill: {
    minWidth: 94,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DEE2E6',
  },
  filterPillActive: { backgroundColor: '#E94560', borderColor: '#E94560' },
  filterText: { color: '#1A1A2E', fontSize: 13, fontWeight: '800' },
  filterTextActive: { color: '#FFFFFF' },
  filterCount: { color: '#6C757D', fontSize: 12, fontWeight: '900', marginLeft: 7 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { color: '#E74C3C', fontSize: 13, fontWeight: '700', marginLeft: 8, flex: 1 },
  loadingPanel: { height: 170, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  cardBody: { flex: 1, minWidth: 0 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { color: '#1A1A2E', fontSize: 15, fontWeight: '900', flex: 1 },
  severityDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  cardMessage: { color: '#6C757D', fontSize: 13, fontWeight: '700', lineHeight: 18, marginTop: 6 },
  cardDetail: { color: '#1A1A2E', fontSize: 12, fontWeight: '800', marginTop: 7 },
  emptyPanel: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 28 },
  emptyIcon: { width: 74, height: 74, borderRadius: 37, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF8F0', marginBottom: 14 },
  emptyTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900', marginBottom: 8 },
  emptyText: { color: '#6C757D', fontSize: 14, fontWeight: '700', textAlign: 'center', lineHeight: 20 },
});
