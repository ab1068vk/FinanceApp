import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Modal from 'react-native-modal';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import { format } from 'date-fns';
import { DatePickerField } from '../../components/common/DatePickerField';
import { AdminStackParamList } from '../../navigation';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { AuditLog, fetchAuditLogs, fetchMoreAuditLogs } from '../../store/slices/adminSlice';
import { useTheme } from '../../theme';

type Props = StackScreenProps<AdminStackParamList, 'AuditLogs'>;

const actionOptions = [
  'All',
  'SECURITY_ATTACK_ATTEMPT',
  'SECURITY_AUTH_FAILURE',
  'SECURITY_ACCOUNT_LOCKED',
  'USER_LOGIN',
  'USER_LOGOUT',
  'PASSWORD_CHANGED',
  'ADMIN_UPDATED_USER_STATUS',
  'ADMIN_UPDATED_USER_ROLE',
  'ADMIN_RESET_USER_PASSWORD',
  'ADMIN_DELETED_USER_PERMANENTLY',
  'ADMIN_VIEWED_USER_DATA',
];

function badgeColor(action: string, colors: ReturnType<typeof useTheme>['colors']) {
  if (action.includes('DELETE') || action.includes('DEACTIVATE')) return colors.danger;
  if (action.includes('SECURITY_ATTACK')) return colors.danger;
  if (action.includes('SECURITY_AUTH') || action.includes('LOCKED')) return colors.warning;
  if (action.includes('PASSWORD')) return colors.warning;
  if (action.includes('LOGIN')) return colors.accent;
  if (action.includes('ADMIN')) return colors.highlight;
  return colors.secondary;
}

function prettyDate(value?: string | null) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : format(date, 'MMM d, yyyy h:mm a');
}

function truncate(value?: string | null) {
  if (!value) return 'None';
  return value.length > 18 ? `${value.slice(0, 18)}...` : value;
}

function formatJson(value?: string | null) {
  if (!value) return 'None';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function attackSummary(log: AuditLog) {
  if (!log.action.startsWith('SECURITY_')) return null;
  try {
    const payload = JSON.parse(log.new_value || '{}');
    const first = Array.isArray(payload.findings) ? payload.findings[0] : null;
    if (!first) return null;
    return `${first.attack_type || 'security'} in ${first.input_path || 'input'}: ${first.input_preview || ''}`;
  } catch {
    return null;
  }
}

export default function AuditLogsScreen({ route }: Props) {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const { auditLogs, auditLogsLoadingMore, isLoading, error, pagination } = useAppSelector((state) => state.admin);
  const [selectedAction, setSelectedAction] = useState(route.params?.initialAction || 'All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    filterBar: { padding: theme.spacing.md, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    dateRow: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
    inputWrap: { flex: 1, backgroundColor: theme.colors.background },
    chips: { gap: theme.spacing.sm },
    chip: { borderRadius: theme.borderRadius.full, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, marginRight: theme.spacing.sm, backgroundColor: theme.colors.surface },
    chipActive: { borderColor: theme.colors.highlight, backgroundColor: theme.colors.highlight },
    chipText: { color: theme.colors.text.secondary, fontSize: theme.typography.xs, fontWeight: '800' },
    chipTextActive: { color: theme.colors.text.inverse },
    list: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl },
    errorBanner: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, margin: theme.spacing.md, marginBottom: 0, borderRadius: theme.borderRadius.sm, backgroundColor: '#FDECEC', padding: theme.spacing.sm },
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm, ...theme.shadows.small },
    topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
    badge: { borderRadius: theme.borderRadius.full, paddingHorizontal: theme.spacing.sm, paddingVertical: 4, maxWidth: '72%' },
    badgeText: { color: theme.colors.text.inverse, fontSize: theme.typography.xs, fontWeight: '800' },
    userText: { color: theme.colors.text.primary, fontSize: theme.typography.md, fontWeight: '800' },
    muted: { color: theme.colors.text.secondary, fontSize: theme.typography.sm },
    metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
    modal: { margin: theme.spacing.md, justifyContent: 'center' },
    modalCard: { maxHeight: '85%', backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.lg, padding: theme.spacing.lg },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md },
    modalTitle: { color: theme.colors.text.primary, fontSize: theme.typography.xl, fontWeight: '800' },
    detailLabel: { color: theme.colors.text.secondary, fontSize: theme.typography.xs, fontWeight: '800', textTransform: 'uppercase', marginTop: theme.spacing.md, marginBottom: theme.spacing.xs },
    codeBlock: { backgroundColor: theme.colors.background, borderRadius: theme.borderRadius.sm, padding: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border },
    codeText: { color: theme.colors.text.primary, fontSize: theme.typography.xs, lineHeight: 18 },
    empty: { alignItems: 'center', padding: theme.spacing.xl, gap: theme.spacing.sm },
  }), [theme]);

  const loadLogs = useCallback(() => {
    dispatch(fetchAuditLogs({
      action: selectedAction === 'All' ? undefined : selectedAction,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      limit: 50,
    }));
  }, [dispatch, endDate, selectedAction, startDate]);

  const loadMoreLogs = useCallback(() => {
    const auditPagination = pagination.auditLogs;
    if (isLoading || auditLogsLoadingMore || auditPagination.page >= auditPagination.totalPages) return;
    dispatch(fetchMoreAuditLogs({
      action: selectedAction === 'All' ? undefined : selectedAction,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      page: auditPagination.page + 1,
      limit: auditPagination.limit || 50,
    }));
  }, [auditLogsLoadingMore, dispatch, endDate, isLoading, pagination.auditLogs, selectedAction, startDate]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  function renderLog({ item }: { item: AuditLog }) {
    const color = badgeColor(item.action, theme.colors);
    return (
      <Pressable style={styles.card} onPress={() => setSelectedLog(item)}>
        <View style={styles.topRow}>
          <View style={[styles.badge, { backgroundColor: color }]}><Text style={styles.badgeText} numberOfLines={1}>{item.action}</Text></View>
          <Feather name="chevron-right" size={18} color={theme.colors.text.light} />
        </View>
        <Text style={styles.userText} numberOfLines={1}>{item.user_email || 'System / deleted user'}</Text>
        <Text style={styles.muted} numberOfLines={2}>{item.summary || attackSummary(item) || item.action_label || item.action.replace(/_/g, ' ')}</Text>
        <Text style={styles.muted}>{item.entity_type || 'System'} - {truncate(item.entity_id)}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.muted}>{prettyDate(item.created_at)}</Text>
          <Text style={styles.muted}>{item.ip_address || 'No IP'}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        <View style={styles.dateRow}>
          <DatePickerField value={startDate} onChange={setStartDate} placeholder="Start date" allowClear style={styles.inputWrap} />
          <DatePickerField value={endDate} onChange={setEndDate} placeholder="End date" allowClear style={styles.inputWrap} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {actionOptions.map((action) => {
            const active = selectedAction === action;
            return (
              <Pressable key={action} style={[styles.chip, active && styles.chipActive]} onPress={() => setSelectedAction(action)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{action.replace(/_/g, ' ')}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Feather name="alert-circle" size={18} color={theme.colors.danger} />
          <Text style={styles.muted}>{error}</Text>
        </View>
      ) : null}

      {isLoading && auditLogs.length === 0 ? (
        <View style={styles.empty}><ActivityIndicator color={theme.colors.highlight} /></View>
      ) : (
        <FlatList
          data={auditLogs}
          keyExtractor={(item) => item.id}
          renderItem={renderLog}
          contentContainerStyle={styles.list}
          refreshing={isLoading}
          onRefresh={loadLogs}
          onEndReached={loadMoreLogs}
          onEndReachedThreshold={0.3}
          ListFooterComponent={auditLogsLoadingMore ? <ActivityIndicator color={theme.colors.highlight} /> : null}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Feather name="file-text" size={42} color={theme.colors.text.light} />
              <Text style={styles.muted}>No audit logs match the current filters.</Text>
            </View>
          )}
        />
      )}

      <Modal isVisible={selectedLog !== null} onBackdropPress={() => setSelectedLog(null)} style={styles.modal}>
        <View style={styles.modalCard}>
          {selectedLog ? (
            <>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Audit Details</Text>
                <Pressable onPress={() => setSelectedLog(null)}><Feather name="x" size={24} color={theme.colors.text.primary} /></Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.detailLabel}>Action</Text>
                <View style={[styles.badge, { backgroundColor: badgeColor(selectedLog.action, theme.colors), alignSelf: 'flex-start' }]}><Text style={styles.badgeText}>{selectedLog.action_label || selectedLog.action}</Text></View>
                <Text style={styles.detailLabel}>Summary</Text>
                <Text style={styles.userText}>{selectedLog.summary || attackSummary(selectedLog) || selectedLog.action.replace(/_/g, ' ')}</Text>
                <Text style={styles.detailLabel}>User</Text>
                <Text style={styles.userText}>{selectedLog.user_email || 'System / deleted user'}</Text>
                <Text style={styles.muted}>{selectedLog.user_full_name || selectedLog.user_id || 'No user attached'}</Text>
                <Text style={styles.detailLabel}>Entity</Text>
                <Text style={styles.muted}>{selectedLog.entity_type || 'None'} - {selectedLog.entity_id || 'None'}</Text>
                <Text style={styles.detailLabel}>Request</Text>
                <Text style={styles.muted}>{prettyDate(selectedLog.created_at)} - {selectedLog.ip_address || 'No IP'}</Text>
                <Text style={styles.muted}>{selectedLog.user_agent || 'No user agent'}</Text>
                {attackSummary(selectedLog) ? (
                  <>
                    <Text style={styles.detailLabel}>Security Finding</Text>
                    <View style={styles.codeBlock}><Text style={styles.codeText}>{attackSummary(selectedLog)}</Text></View>
                  </>
                ) : null}
                <Text style={styles.detailLabel}>Old Value</Text>
                <View style={styles.codeBlock}><Text style={styles.codeText}>{formatJson(selectedLog.old_value)}</Text></View>
                <Text style={styles.detailLabel}>New Value</Text>
                <View style={styles.codeBlock}><Text style={styles.codeText}>{formatJson(selectedLog.new_value)}</Text></View>
              </ScrollView>
            </>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
