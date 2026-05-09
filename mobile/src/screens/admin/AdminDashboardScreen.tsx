import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import Feather from '@expo/vector-icons/Feather';
import { format } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { AdminStackParamList } from '../../navigation';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchAdminStats, fetchAuditLogs, fetchSystemHealth, AuditLog } from '../../store/slices/adminSlice';
import { logoutUser } from '../../store/slices/authSlice';
import { auditActionLabel, auditEnglishSummary } from '../../utils/auditLogs';
import type { FeatherIconName } from '../../utils/icons';

type Props = StackScreenProps<AdminStackParamList, 'AdminDashboard'>;
const chartWidth = 330;

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
}

function badgeColor(action: string) {
  if (action.includes('DELETE')) return '#E74C3C';
  if (action.includes('PASSWORD')) return '#F39C12';
  if (action.includes('LOGIN')) return '#0F3460';
  return '#6C757D';
}

function healthStatus(dbSize = 0, logs = 0) {
  if (dbSize > 500 || logs > 500) return { color: '#E74C3C', label: 'Critical' };
  if (dbSize > 100 || logs > 100) return { color: '#F39C12', label: 'Warning' };
  return { color: '#27AE60', label: 'Healthy' };
}

export default function AdminDashboardScreen({ navigation }: Props) {
  const dispatch = useAppDispatch();
  const { stats, auditLogs, systemHealth, isLoading } = useAppSelector((state) => state.admin);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  const refreshDashboard = useCallback(async (signal?: AbortSignal) => {
    const [statsResult, healthResult, auditResult] = await Promise.allSettled([
      dispatch(fetchAdminStats()).unwrap(),
      dispatch(fetchSystemHealth()).unwrap(),
      dispatch(fetchAuditLogs({ limit: 10 })).unwrap(),
    ]);

    if (signal?.aborted) return;
    setStatsError(statsResult.status === 'rejected' ? 'Dashboard stats failed to load.' : null);
    setHealthError(healthResult.status === 'rejected' ? 'System health failed to load.' : null);
    setAuditError(auditResult.status === 'rejected' ? 'Recent audit logs failed to load.' : null);
  }, [dispatch]);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      refreshDashboard(controller.signal);
      return () => controller.abort();
    }, [refreshDashboard]),
  );

  const status = healthStatus(systemHealth?.db_size_mb || stats?.system_health.db_size_mb, systemHealth?.log_count || stats?.system_health.log_count);
  const recentSecurityLogs = stats?.security.recent_events || [];
  const chartData = useMemo(() => {
    const rows = stats?.daily_transaction_volume || [];
    const trimmed = rows.slice(-7);
    return {
      labels: trimmed.map((row) => format(new Date(row.date), 'd')),
      datasets: [{ data: trimmed.map((row) => row.count), color: () => '#E94560', strokeWidth: 3 }],
    };
  }, [stats]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refreshDashboard} tintColor="#E94560" colors={["#E94560"]} />}
    >
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View style={styles.shieldCircle}><Feather name="shield" size={24} color="#FFFFFF" /></View>
          <View>
            <Text style={styles.headerTitle}>Admin Panel</Text>
            <Text style={styles.headerSubtitle}>System control center</Text>
          </View>
        </View>
        <View style={styles.healthPill}><View style={[styles.healthDot, { backgroundColor: status.color }]} /><Text style={styles.healthText}>{status.label}</Text></View>
      </View>

      {statsError || healthError ? (
        <View style={styles.errorBanner}>
          <Feather name="alert-circle" size={18} color="#E74C3C" />
          <Text style={styles.errorText}>{[statsError, healthError].filter(Boolean).join(' ')}</Text>
        </View>
      ) : null}

      {isLoading && !stats ? <ActivityIndicator color="#E94560" style={styles.loader} /> : null}

      <View style={styles.statsGrid}>
        <MetricCard title="Total Users" value={String(stats?.total_users.total || 0)} subtitle={`${stats?.new_users_this_month || 0} new this month`} />
        <MetricCard title="Deleted Users" value={String(stats?.deleted_users_count || 0)} subtitle="Archived separately" />
        <MetricCard title="Active Sessions" value={String(systemHealth?.active_sessions || 0)} subtitle="Live refresh tokens" />
        <MetricCard title="Transactions" value={String(stats?.total_transactions.count || 0)} subtitle={`${stats?.new_transactions_this_month || 0} this month`} />
        <MetricCard title="Total Volume" value={formatCurrency(stats?.total_transactions.sum || 0)} subtitle="Across all users" />
        <MetricCard title="Attack Attempts" value={String(stats?.security.attack_attempts || 0)} subtitle="Suspicious inputs" />
        <MetricCard title="Auth Failures" value={String(stats?.security.auth_failures || 0)} subtitle="Failed logins and locks" />
      </View>

      <View style={styles.quickRow}>
        <QuickAction icon="users" label="Users" onPress={() => navigation.navigate('UsersList')} />
        <QuickAction icon="user-x" label="Inactive" onPress={() => navigation.navigate('UsersList', { initialFilter: 'inactive' })} />
        <QuickAction icon="lock" label="Locked" onPress={() => navigation.navigate('UsersList', { initialFilter: 'locked' })} />
        <QuickAction icon="list" label="Transactions" onPress={() => navigation.navigate('AdminTransactions')} />
        <QuickAction icon="tag" label="Defaults" onPress={() => navigation.navigate('DefaultCategories')} />
        <QuickAction icon="archive" label="Deleted" onPress={() => navigation.navigate('DeletedUsers')} />
        <QuickAction icon="shield" label="Security" onPress={() => navigation.navigate('AuditLogs', { initialAction: 'SECURITY_ATTACK_ATTEMPT' })} />
        <QuickAction icon="clipboard" label="Audit Logs" onPress={() => navigation.navigate('AuditLogs', undefined)} />
        <QuickAction icon="monitor" label="System" onPress={() => navigation.navigate('SystemHealth')} />
        <QuickAction icon="tool" label="Tools" onPress={() => navigation.navigate('AdminTools')} />
        <QuickAction icon="log-out" label="Sign Out" onPress={() => dispatch(logoutUser())} />
      </View>

      <Section title="Security Events">
        {recentSecurityLogs.length ? recentSecurityLogs.map((log) => <AuditRow key={log.id} log={log} />) : <EmptyText text="No security events recorded." />}
      </Section>

      <Section title="Top Categories">
        {(stats?.top_5_categories_by_spending || []).length ? stats?.top_5_categories_by_spending.map((item) => <HorizontalBar key={item.category_name} label={item.category_name} value={item.total} max={stats.top_5_categories_by_spending[0]?.total || 1} />) : <EmptyText text="No spending categories yet." />}
      </Section>

      <Section title="Daily Activity">
        {chartData.labels.length ? (
          <LineChart
            data={chartData}
            width={chartWidth}
            height={210}
            fromZero
            bezier
            withInnerLines={false}
            chartConfig={{ backgroundColor: '#FFFFFF', backgroundGradientFrom: '#FFFFFF', backgroundGradientTo: '#FFFFFF', decimalPlaces: 0, color: () => '#1A1A2E', labelColor: () => '#6C757D', propsForDots: { r: '4' } }}
            style={styles.lineChart}
          />
        ) : <EmptyText text="No daily transaction activity yet." />}
      </Section>

      <Section title="Recent Audit Log">
        {auditError ? <Text style={styles.inlineErrorText}>{auditError}</Text> : null}
        {auditLogs.slice(0, 10).map((log) => <AuditRow key={log.id} log={log} />)}
        {!auditLogs.length && !auditError ? <EmptyText text="No audit activity yet." /> : null}
      </Section>
    </ScrollView>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return <View style={styles.metricCard}><Text style={styles.metricTitle}>{title}</Text><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricSubtitle}>{subtitle}</Text></View>;
}

function QuickAction({ icon, label, onPress }: { icon: FeatherIconName; label: string; onPress: () => void }) {
  return <TouchableOpacity style={styles.quickAction} onPress={onPress}><View style={styles.quickIcon}><Feather name={icon} size={21} color="#E94560" /></View><Text style={styles.quickLabel}>{label}</Text></TouchableOpacity>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.sectionCard}>{children}</View></View>;
}

function HorizontalBar({ label, value, max }: { label: string; value: number; max: number }) {
  return <View style={styles.barRow}><Text style={styles.barLabel}>{label}</Text><View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.min((value / max) * 100, 100)}%` }]} /></View><Text style={styles.barValue}>{formatCurrency(value)}</Text></View>;
}

function AuditRow({ log }: { log: AuditLog }) {
  return <View style={styles.auditRow}><View style={[styles.actionBadge, { backgroundColor: `${badgeColor(log.action)}18` }]}><Text style={[styles.actionText, { color: badgeColor(log.action) }]}>{log.action_label || auditActionLabel(log.action)}</Text></View><View style={styles.auditTextBlock}><Text style={styles.auditEmail}>{auditEnglishSummary(log)}</Text><Text style={styles.auditDate}>{format(new Date(log.created_at), 'MMM d, h:mm a')}</Text></View></View>;
}

function EmptyText({ text }: { text: string }) {
  return <Text style={styles.emptyText}>{text}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { paddingBottom: 30 },
  header: { minHeight: 150, backgroundColor: '#1A1A2E', padding: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center' },
  shieldCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(233,69,96,0.3)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  headerTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '900' },
  headerSubtitle: { color: '#ADB5BD', fontSize: 13, marginTop: 4 },
  healthPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  healthDot: { width: 9, height: 9, borderRadius: 5, marginRight: 6 },
  healthText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  loader: { marginTop: 18 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#FDECEC', padding: 12, margin: 20, marginBottom: 0 },
  errorText: { color: '#E74C3C', fontSize: 13, fontWeight: '800', flex: 1 },
  inlineErrorText: { color: '#E74C3C', fontSize: 13, fontWeight: '800', paddingVertical: 10, textAlign: 'center' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 20 },
  metricCard: { width: '47.9%', minHeight: 112, borderRadius: 16, backgroundColor: '#FFFFFF', padding: 14, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  metricTitle: { color: '#6C757D', fontSize: 12, fontWeight: '900' },
  metricValue: { color: '#1A1A2E', fontSize: 24, fontWeight: '900', marginTop: 10 },
  metricSubtitle: { color: '#ADB5BD', fontSize: 11, fontWeight: '800', marginTop: 8 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20, marginBottom: 6 },
  quickAction: { width: '30.6%', alignItems: 'center', marginBottom: 12 },
  quickIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  quickLabel: { color: '#1A1A2E', fontSize: 12, fontWeight: '800', marginTop: 8, textAlign: 'center' },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900', marginBottom: 10 },
  sectionCard: { borderRadius: 18, backgroundColor: '#FFFFFF', padding: 16, overflow: 'hidden' },
  lineChart: { marginLeft: -14, borderRadius: 14 },
  barRow: { marginBottom: 14 },
  barLabel: { color: '#1A1A2E', fontSize: 14, fontWeight: '900', marginBottom: 7 },
  barTrack: { height: 9, borderRadius: 999, backgroundColor: '#EEF0F2', overflow: 'hidden' },
  barFill: { height: 9, borderRadius: 999, backgroundColor: '#E94560' },
  barValue: { color: '#6C757D', fontSize: 12, fontWeight: '800', marginTop: 5 },
  auditRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F3F5' },
  actionBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6, marginRight: 10, maxWidth: 150 },
  actionText: { fontSize: 10, fontWeight: '900' },
  auditTextBlock: { flex: 1 },
  auditEmail: { color: '#1A1A2E', fontSize: 13, fontWeight: '800' },
  auditDate: { color: '#6C757D', fontSize: 12, marginTop: 3 },
  emptyText: { color: '#6C757D', fontSize: 14, fontWeight: '700', textAlign: 'center', paddingVertical: 18 },
});
