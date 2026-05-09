import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Modal from 'react-native-modal';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import { format, formatDistanceToNow } from 'date-fns';
import { DatePickerField } from '../../components/common/DatePickerField';
import { showToast } from '../../components/common/Toast';
import { AdminStackParamList } from '../../navigation';
import api from '../../services/api';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  deleteUserPermanently,
  exportUserData,
  fetchUserBudgetPerformance,
  fetchUserDetail,
  fetchUserLoginHistory,
  fetchUserSpendingByCategory,
  fetchUserTransactions,
  resetUserPassword,
  updateUserRole,
  updateUserStatus,
} from '../../store/slices/adminSlice';
import { useTheme } from '../../theme';
import { auditActionLabel, auditEnglishSummary } from '../../utils/auditLogs';

type Props = StackScreenProps<AdminStackParamList, 'UserDetail'>;
type ActionType = 'status' | 'role' | 'password' | 'transactions' | 'accounts' | 'deleteAccount' | 'delete' | null;
type AdminAccount = { id: string; name: string; type: string; balance: number; currency: string; is_active: boolean; transaction_count?: number };
type SupportTokenResult = { accessToken: string; expires_in: string; warning?: string; user?: { email?: string; full_name?: string } };
type AccountTransactionAction = 'cash' | 'delete';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function initials(name?: string) {
  return (name || 'User')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';
}

function niceDate(value?: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : format(date, 'MMM d, yyyy h:mm a');
}

function downloadWebFile(contents: string, filename: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function writeTextFile(filename: string, contents: string, mimeType: string) {
  if (Platform.OS === 'web') {
    downloadWebFile(contents, filename, mimeType);
    return null;
  }

  const file = new FileSystem.File(FileSystem.Paths.document, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);
  return file.uri;
}

async function shareFile(uri: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(uri, { mimeType });
}

function actionColor(action: string, highlight: string, warning: string, danger: string, accent: string) {
  if (action.includes('DELETE') || action.includes('DEACTIVATE')) return danger;
  if (action.includes('PASSWORD')) return warning;
  if (action.includes('LOGIN')) return accent;
  return highlight;
}

export default function UserDetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const {
    selectedUser,
    selectedUserTransactions,
    selectedUserSpending,
    selectedUserBudgets,
    selectedUserLoginHistory,
    isLoading,
  } = useAppSelector((state) => state.admin);
  const currentUser = useAppSelector((state) => state.auth.user);
  const [pendingAction, setPendingAction] = useState<ActionType>(null);
  const [tempPassword, setTempPassword] = useState('');
  const [resetPasswordResult, setResetPasswordResult] = useState<string | null>(null);
  const [resetDeliveryMessage, setResetDeliveryMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transactionStartDate, setTransactionStartDate] = useState('');
  const [transactionEndDate, setTransactionEndDate] = useState('');
  const [userAccounts, setUserAccounts] = useState<AdminAccount[]>([]);
  const [selectedAccountForDelete, setSelectedAccountForDelete] = useState<AdminAccount | null>(null);
  const [accountDeleteReason, setAccountDeleteReason] = useState('');
  const [accountTransactionAction, setAccountTransactionAction] = useState<AccountTransactionAction>('cash');
  const [supportToken, setSupportToken] = useState<SupportTokenResult | null>(null);

  const user = selectedUser?.user;
  const isActive = Boolean(user?.is_active);
  const isSelf = Boolean(user && currentUser?.id === user.id);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    scroll: { paddingBottom: theme.spacing.xl },
    header: { backgroundColor: theme.colors.primary, padding: theme.spacing.lg, paddingTop: theme.spacing.xl },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent },
    avatarText: { color: theme.colors.text.inverse, fontSize: theme.typography.xl, fontWeight: '800' },
    titleWrap: { flex: 1 },
    name: { color: theme.colors.text.inverse, fontSize: theme.typography.xxl, fontWeight: '800' },
    roleBadge: { alignSelf: 'flex-start', marginTop: theme.spacing.xs, borderRadius: theme.borderRadius.full, paddingHorizontal: theme.spacing.sm, paddingVertical: 3, backgroundColor: user?.role === 'admin' ? theme.colors.highlight : theme.colors.accent },
    roleText: { color: theme.colors.text.inverse, fontSize: theme.typography.xs, fontWeight: '800', textTransform: 'uppercase' },
    card: { marginHorizontal: theme.spacing.md, marginTop: theme.spacing.md, padding: theme.spacing.md, borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.surface, ...theme.shadows.medium },
    statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: theme.colors.text.primary, fontSize: theme.typography.lg, fontWeight: '800', marginBottom: theme.spacing.sm },
    subtle: { color: theme.colors.text.secondary, fontSize: theme.typography.sm },
    statusLabel: { color: isActive ? theme.colors.success : theme.colors.danger, fontSize: theme.typography.md, fontWeight: '800' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    actionButton: { flexBasis: '48%', flexGrow: 1, minHeight: 78, borderRadius: theme.borderRadius.md, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs, backgroundColor: theme.colors.surface },
    dangerButton: { borderColor: theme.colors.danger, backgroundColor: '#FDECEC' },
    disabledAction: { opacity: 0.45 },
    actionText: { color: theme.colors.text.primary, fontSize: theme.typography.sm, fontWeight: '700', textAlign: 'center' },
    infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    infoCell: { width: '48%', padding: theme.spacing.sm, borderRadius: theme.borderRadius.sm, backgroundColor: theme.colors.background },
    infoLabel: { color: theme.colors.text.secondary, fontSize: theme.typography.xs, marginBottom: 2 },
    infoValue: { color: theme.colors.text.primary, fontSize: theme.typography.md, fontWeight: '800' },
    auditItem: { paddingVertical: theme.spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
    auditTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm },
    auditBadge: { borderRadius: theme.borderRadius.full, paddingHorizontal: theme.spacing.sm, paddingVertical: 3 },
    auditBadgeText: { color: theme.colors.text.inverse, fontSize: theme.typography.xs, fontWeight: '800' },
    modal: { margin: theme.spacing.md, justifyContent: 'center' },
    modalCard: { backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.lg, padding: theme.spacing.lg },
    modalTitle: { color: theme.colors.text.primary, fontSize: theme.typography.xl, fontWeight: '800', marginBottom: theme.spacing.sm },
    modalBody: { color: theme.colors.text.secondary, fontSize: theme.typography.md, lineHeight: 21, marginBottom: theme.spacing.md },
    input: { height: 48, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing.md, color: theme.colors.text.primary, backgroundColor: theme.colors.background, marginBottom: theme.spacing.md },
    modalButtons: { flexDirection: 'row', gap: theme.spacing.sm },
    secondaryButton: { flex: 1, height: 48, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
    primaryButton: { flex: 1, height: 48, borderRadius: theme.borderRadius.sm, backgroundColor: theme.colors.highlight, alignItems: 'center', justifyContent: 'center' },
    buttonText: { color: theme.colors.text.inverse, fontSize: theme.typography.md, fontWeight: '800' },
    secondaryText: { color: theme.colors.text.primary, fontSize: theme.typography.md, fontWeight: '700' },
    transactionItem: { paddingVertical: theme.spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
    filterRow: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
    filterInput: { flex: 1, height: 42, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing.sm, color: theme.colors.text.primary, backgroundColor: theme.colors.background },
    miniButton: { height: 42, borderRadius: theme.borderRadius.sm, backgroundColor: theme.colors.highlight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
    metricRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
    metricName: { color: theme.colors.text.primary, fontSize: theme.typography.sm, fontWeight: '800', flex: 1 },
    metricValue: { color: theme.colors.text.primary, fontSize: theme.typography.sm, fontWeight: '800' },
    progressTrack: { height: 7, borderRadius: theme.borderRadius.full, backgroundColor: theme.colors.border, overflow: 'hidden', marginTop: 5 },
    progressFill: { height: 7, borderRadius: theme.borderRadius.full },
    empty: { alignItems: 'center', padding: theme.spacing.lg },
    code: { color: theme.colors.text.primary, fontSize: theme.typography.xs, marginTop: theme.spacing.sm, marginBottom: theme.spacing.md, backgroundColor: theme.colors.background, borderRadius: theme.borderRadius.sm, padding: theme.spacing.sm },
    accountActions: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
    accountActionButton: { flex: 1, height: 40, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
    accountDeleteButton: { borderColor: theme.colors.danger, backgroundColor: '#FDECEC' },
    choiceRow: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
    choiceButton: { flex: 1, minHeight: 54, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
    choiceButtonActive: { borderColor: theme.colors.highlight, backgroundColor: '#FFF5F7' },
    choiceText: { color: theme.colors.text.primary, fontSize: theme.typography.sm, fontWeight: '800', textAlign: 'center' },
  }), [isActive, theme, user?.role]);

  const load = useCallback(() => {
    dispatch(fetchUserDetail(id));
  }, [dispatch, id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    dispatch(fetchUserSpendingByCategory({ id }));
    dispatch(fetchUserBudgetPerformance(id));
    dispatch(fetchUserLoginHistory({ id, filters: { limit: 20 } }));
  }, [dispatch, id]);

  const actionText = useMemo(() => {
    if (!user) return { title: '', body: '', confirm: '' };
    if (pendingAction === 'status') {
      return {
        title: isActive ? 'Deactivate User' : 'Activate User',
        body: `This will ${isActive ? 'deactivate' : 'reactivate'} ${user.email}.`,
        confirm: isActive ? 'Deactivate' : 'Activate',
      };
    }
    if (pendingAction === 'role') {
      return {
        title: 'Change Role',
        body: `Change ${user.email} to ${user.role === 'admin' ? 'a standard user' : 'an administrator'}?`,
        confirm: 'Change Role',
      };
    }
    if (pendingAction === 'password') {
      return {
        title: 'Reset Password',
        body: 'Leave the field blank to generate a temporary password. The user must use it once, then choose a new password at login.',
        confirm: resetPasswordResult ? 'Done' : 'Reset Password',
      };
    }
    if (pendingAction === 'delete') {
      return {
        title: 'Delete User Permanently',
        body: `This will permanently delete ${user.email} and their related accounts, transactions, budgets, tokens, and user audit records from the dataset.`,
        confirm: 'Delete Permanently',
      };
    }
    return { title: 'User Transactions', body: '', confirm: '' };
  }, [isActive, pendingAction, resetPasswordResult, user]);

  async function openTransactions() {
    setPendingAction('transactions');
    dispatch(fetchUserTransactions({ id, filters: { start_date: transactionStartDate, end_date: transactionEndDate } }));
  }

  async function openAccounts() {
    setPendingAction('accounts');
    try {
      const response = await api.get<{ data: AdminAccount[] }>(`/api/admin/users/${id}/accounts`);
      setUserAccounts(response.data.data || []);
    } catch (error) {
      showToast({ type: 'error', text1: 'Accounts failed to load' });
    }
  }

  async function toggleAccount(account: AdminAccount) {
    try {
      await api.put(`/api/admin/users/${id}/accounts/${account.id}/status`, {
        is_active: !account.is_active,
        reason: 'Admin support account status change',
      });
      showToast({ type: 'success', text1: account.is_active ? 'Account closed' : 'Account reactivated' });
      openAccounts();
      load();
    } catch (error) {
      showToast({ type: 'error', text1: 'Account update failed' });
    }
  }

  function startDeleteAccount(account: AdminAccount) {
    setSelectedAccountForDelete(account);
    setAccountDeleteReason('');
    setAccountTransactionAction((account.transaction_count || 0) > 0 ? 'cash' : 'delete');
    setPendingAction('deleteAccount');
  }

  async function deleteSelectedAccount() {
    if (!selectedAccountForDelete) return;
    if (accountDeleteReason.trim().length < 5) {
      showToast({ type: 'error', text1: 'Reason required', text2: 'Enter at least 5 characters for the audit log.' });
      return;
    }

    setIsSubmitting(true);
    try {
      await api.delete(`/api/admin/users/${id}/accounts/${selectedAccountForDelete.id}`, {
        data: {
          reason: accountDeleteReason.trim(),
          transaction_action: accountTransactionAction,
        },
      });
      showToast({ type: 'success', text1: 'Account deleted', text2: 'The action was recorded in the audit log.' });
      setPendingAction('accounts');
      setSelectedAccountForDelete(null);
      setAccountDeleteReason('');
      await openAccounts();
      load();
    } catch (error) {
      showToast({ type: 'error', text1: 'Account delete failed', text2: 'Check the reason and transaction handling option.' });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function revokeSessions() {
    try {
      const response = await api.post<{ revoked: number }>(`/api/admin/users/${id}/revoke-sessions`);
      showToast({ type: 'success', text1: 'Sessions revoked', text2: `${response.data.revoked} sessions revoked.` });
      load();
    } catch (error) {
      showToast({ type: 'error', text1: 'Revoke sessions failed' });
    }
  }

  async function startImpersonation() {
    try {
      const response = await api.post<SupportTokenResult>(`/api/admin/users/${id}/impersonate`, { reason: 'Admin support reproduction' });
      setSupportToken(response.data);
      showToast({ type: 'success', text1: 'Support token issued', text2: `Expires in ${response.data.expires_in}.` });
    } catch (error) {
      showToast({ type: 'error', text1: 'Impersonation failed' });
    }
  }

  async function exportData() {
    setIsSubmitting(true);
    try {
      const data = await dispatch(exportUserData(id)).unwrap();
      const filename = `user-export-${user?.email || id}-${new Date().toISOString().slice(0, 10)}.json`.replace(/[^a-zA-Z0-9._-]/g, '-');
      const uri = await writeTextFile(filename, JSON.stringify(data, null, 2), 'application/json');
      if (uri) await shareFile(uri, 'application/json');
      showToast({
        type: 'success',
        text1: 'User data exported',
        text2: `${filename}: ${data.accounts.length} accounts, ${data.transactions.length} transactions, ${data.budgets.length} budgets`,
      });
    } catch (error) {
      showToast({ type: 'error', text1: 'Export failed', text2: typeof error === 'string' ? error : 'Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmAction() {
    if (!user || !pendingAction) return;
    if (isSelf && ['status', 'role', 'delete'].includes(pendingAction)) {
      showToast({ type: 'error', text1: 'Action not allowed', text2: 'Admins cannot change their own role, status, or delete their own account.' });
      setPendingAction(null);
      return;
    }
    setIsSubmitting(true);
    try {
      if (pendingAction === 'status') {
        await dispatch(updateUserStatus({ id: user.id, isActive: !isActive })).unwrap();
        showToast({ type: 'success', text1: isActive ? 'User deactivated' : 'User activated' });
      }
      if (pendingAction === 'role') {
        await dispatch(updateUserRole({ id: user.id, role: user.role === 'admin' ? 'user' : 'admin' })).unwrap();
        showToast({ type: 'success', text1: 'Role updated' });
      }
      if (pendingAction === 'password') {
        if (resetPasswordResult) {
          setPendingAction(null);
          setResetPasswordResult(null);
          setResetDeliveryMessage('');
          setTempPassword('');
          return;
        }
        const response = await dispatch(resetUserPassword({ id: user.id, tempPassword })).unwrap();
        setResetPasswordResult(response.temporary_password);
        const delivered = response.delivery?.sent && response.delivery.channel === 'email';
        setResetDeliveryMessage(delivered ? `Sent to ${user.email}.` : 'Email delivery is not configured. Share this password with the user through your support channel.');
        showToast({
          type: 'success',
          text1: delivered ? 'Temporary password emailed' : 'Temporary password generated',
          text2: delivered ? `Sent to ${user.email}.` : 'Manual handoff required.',
        });
        load();
        return;
      }
      if (pendingAction === 'delete') {
        await dispatch(deleteUserPermanently(user.id)).unwrap();
        showToast({ type: 'success', text1: 'User deleted permanently' });
        setPendingAction(null);
        navigation.goBack();
        return;
      }
      setPendingAction(null);
      setResetPasswordResult(null);
      setResetDeliveryMessage('');
      load();
    } catch (error) {
      showToast({ type: 'error', text1: 'Admin action failed', text2: typeof error === 'string' ? error : 'Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading && !selectedUser) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}> 
        <ActivityIndicator color={theme.colors.highlight} />
      </View>
    );
  }

  if (!user || !selectedUser) {
    return (
      <View style={[styles.container, styles.empty]}>
        <Feather name="user-x" size={42} color={theme.colors.text.light} />
        <Text style={styles.subtle}>User details are unavailable.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(user.full_name)}</Text></View>
            <View style={styles.titleWrap}>
              <Text style={styles.name}>{user.full_name}</Text>
              <View style={styles.roleBadge}><Text style={styles.roleText}>{user.role}</Text></View>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View>
              <Text style={styles.sectionTitle}>Account Status</Text>
              <Text style={styles.statusLabel}>{isActive ? 'Active' : 'Inactive'}</Text>
              <Text style={styles.subtle}>Last login: {niceDate(user.last_login)}</Text>
            </View>
            <Switch
              value={isActive}
              onValueChange={() => {
                if (isSelf) {
                  showToast({ type: 'info', text1: 'Protected admin account', text2: 'Use another admin account for role or status changes.' });
                  return;
                }
                setPendingAction('status');
              }}
              disabled={isSelf}
              trackColor={{ true: theme.colors.success, false: theme.colors.border }}
              thumbColor={theme.colors.surface}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Actions</Text>
          <View style={styles.actions}>
            <Pressable style={styles.actionButton} onPress={() => setPendingAction('password')}>
              <Feather name="key" size={22} color={theme.colors.warning} />
              <Text style={styles.actionText}>Reset Password</Text>
            </Pressable>
            <Pressable style={[styles.actionButton, isSelf && styles.disabledAction]} onPress={() => setPendingAction('role')} disabled={isSelf}>
              <Feather name="shield" size={22} color={theme.colors.highlight} />
              <Text style={styles.actionText}>Change Role</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={openTransactions}>
              <Feather name="list" size={22} color={theme.colors.accent} />
              <Text style={styles.actionText}>View Transactions</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={openAccounts}>
              <Feather name="credit-card" size={22} color={theme.colors.success} />
              <Text style={styles.actionText}>Manage Accounts</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={revokeSessions}>
              <Feather name="log-out" size={22} color={theme.colors.warning} />
              <Text style={styles.actionText}>Revoke Sessions</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={startImpersonation}>
              <Feather name="eye" size={22} color={theme.colors.highlight} />
              <Text style={styles.actionText}>Support Mode</Text>
            </Pressable>
            <Pressable style={[styles.actionButton, isSelf && styles.disabledAction]} onPress={() => setPendingAction('status')} disabled={isSelf}>
              <Feather name={isActive ? 'user-x' : 'user-check'} size={22} color={isActive ? theme.colors.danger : theme.colors.success} />
              <Text style={styles.actionText}>{isActive ? 'Deactivate' : 'Activate'}</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={exportData} disabled={isSubmitting}>
              <Feather name="download" size={22} color={theme.colors.success} />
              <Text style={styles.actionText}>Export Data</Text>
            </Pressable>
            <Pressable style={[styles.actionButton, styles.dangerButton, isSelf && styles.disabledAction]} onPress={() => setPendingAction('delete')} disabled={isSelf}>
              <Feather name="trash-2" size={22} color={theme.colors.danger} />
              <Text style={[styles.actionText, { color: theme.colors.danger }]}>Delete User</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>User Info</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoCell}><Text style={styles.infoLabel}>Email</Text><Text style={styles.infoValue} numberOfLines={1}>{user.email}</Text></View>
            <View style={styles.infoCell}><Text style={styles.infoLabel}>Joined</Text><Text style={styles.infoValue}>{niceDate(user.created_at).split(',')[0]}</Text></View>
            <View style={styles.infoCell}><Text style={styles.infoLabel}>Accounts</Text><Text style={styles.infoValue}>{selectedUser.summary.account_count}</Text></View>
            <View style={styles.infoCell}><Text style={styles.infoLabel}>Total Balance</Text><Text style={styles.infoValue}>{currency.format(selectedUser.summary.total_account_balance || 0)}</Text></View>
            <View style={styles.infoCell}><Text style={styles.infoLabel}>Transactions</Text><Text style={styles.infoValue}>{selectedUser.summary.transaction_count}</Text></View>
            <View style={styles.infoCell}><Text style={styles.infoLabel}>Total Volume</Text><Text style={styles.infoValue}>{currency.format(selectedUser.summary.transaction_total || 0)}</Text></View>
            <View style={styles.infoCell}><Text style={styles.infoLabel}>Active Tokens</Text><Text style={styles.infoValue}>{selectedUser.summary.refresh_token_count}</Text></View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Spending by Category</Text>
          {selectedUserSpending.length === 0 ? <Text style={styles.subtle}>No spending data.</Text> : selectedUserSpending.slice(0, 6).map((item) => (
            <View key={item.category_id || item.category_name} style={styles.metricRow}>
              <View style={{ flex: 1, marginRight: theme.spacing.sm }}>
                <Text style={styles.metricName}>{item.category_name}</Text>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(item.percent, 100)}%`, backgroundColor: item.category_color || theme.colors.highlight }]} /></View>
              </View>
              <Text style={styles.metricValue}>{currency.format(item.total)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Budget Performance</Text>
          {selectedUserBudgets.length === 0 ? <Text style={styles.subtle}>No budgets found.</Text> : selectedUserBudgets.slice(0, 6).map((budget) => (
            <View key={budget.id} style={styles.metricRow}>
              <View style={{ flex: 1, marginRight: theme.spacing.sm }}>
                <Text style={styles.metricName}>{budget.category_name || 'Budget'} ({budget.period})</Text>
                <Text style={styles.subtle}>{currency.format(Number(budget.current_spending || 0))} of {currency.format(Number(budget.amount || 0))}</Text>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(Number(budget.percent_used || 0), 100)}%`, backgroundColor: budget.status === 'over' ? theme.colors.danger : theme.colors.success }]} /></View>
              </View>
              <Text style={[styles.metricValue, { color: budget.status === 'over' ? theme.colors.danger : theme.colors.success }]}>{Number(budget.percent_used || 0).toFixed(0)}%</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Login History</Text>
          {selectedUserLoginHistory.length === 0 ? <Text style={styles.subtle}>No login history found.</Text> : selectedUserLoginHistory.map((log) => (
            <View key={log.id} style={styles.auditItem}>
              <View style={styles.auditTop}>
                <Text style={styles.metricName}>{log.action_label || auditActionLabel(log.action)}</Text>
                <Text style={styles.subtle}>{formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}</Text>
              </View>
              <Text style={styles.subtle}>{auditEnglishSummary(log)}</Text>
              <Text style={styles.subtle}>{log.ip_address || 'No IP'} - {log.user_agent || 'No user agent'}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          {selectedUser.recent_audit_logs.length === 0 ? <Text style={styles.subtle}>No recent activity.</Text> : selectedUser.recent_audit_logs.slice(0, 10).map((log) => {
            const badgeColor = actionColor(log.action, theme.colors.highlight, theme.colors.warning, theme.colors.danger, theme.colors.accent);
            return (
              <View key={log.id} style={styles.auditItem}>
                <View style={styles.auditTop}>
                  <View style={[styles.auditBadge, { backgroundColor: badgeColor }]}><Text style={styles.auditBadgeText}>{log.action_label || auditActionLabel(log.action)}</Text></View>
                  <Text style={styles.subtle}>{formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}</Text>
                </View>
                <Text style={styles.metricName}>{auditEnglishSummary(log)}</Text>
                <Text style={styles.subtle}>{log.action}</Text>
                <Text style={styles.subtle}>{log.entity_type || 'System'} {log.entity_id ? `- ${log.entity_id.slice(0, 8)}` : ''}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <Modal isVisible={pendingAction !== null && pendingAction !== 'transactions' && pendingAction !== 'accounts' && pendingAction !== 'deleteAccount'} onBackdropPress={() => { setPendingAction(null); setResetPasswordResult(null); setResetDeliveryMessage(''); }} style={styles.modal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalCard}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <Text style={styles.modalTitle}>{actionText.title}</Text>
          <Text style={styles.modalBody}>{actionText.body}</Text>
          {pendingAction === 'password' ? (
            resetPasswordResult ? (
              <View>
                <Text style={styles.infoLabel}>Temporary password</Text>
                <Text selectable style={styles.code}>{resetPasswordResult}</Text>
                <Text style={styles.subtle}>{resetDeliveryMessage || 'This is only shown once. The user will be forced to change it after logging in.'}</Text>
              </View>
            ) : (
              <TextInput style={styles.input} value={tempPassword} onChangeText={setTempPassword} placeholder="Optional custom temporary password" placeholderTextColor={theme.colors.text.light} />
            )
          ) : null}
          <View style={styles.modalButtons}>
            <Pressable style={styles.secondaryButton} onPress={() => { setPendingAction(null); setResetPasswordResult(null); setResetDeliveryMessage(''); }} disabled={isSubmitting}><Text style={styles.secondaryText}>{resetPasswordResult ? 'Close' : 'Cancel'}</Text></Pressable>
            <Pressable style={styles.primaryButton} onPress={confirmAction} disabled={isSubmitting}>
              {isSubmitting ? <ActivityIndicator color={theme.colors.text.inverse} /> : <Text style={styles.buttonText}>{actionText.confirm}</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal isVisible={pendingAction === 'transactions'} onBackdropPress={() => setPendingAction(null)} style={styles.modal}>
        <View style={[styles.modalCard, { maxHeight: '78%' }]}> 
          <Text style={styles.modalTitle}>User Transactions</Text>
          <View style={styles.filterRow}>
            <DatePickerField value={transactionStartDate} onChange={setTransactionStartDate} placeholder="Start date" allowClear style={styles.filterInput} />
            <DatePickerField value={transactionEndDate} onChange={setTransactionEndDate} placeholder="End date" allowClear style={styles.filterInput} />
          </View>
          <Pressable style={styles.miniButton} onPress={openTransactions}><Text style={styles.buttonText}>Apply Date Filter</Text></Pressable>
          <FlatList
            data={selectedUserTransactions}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={<Text style={styles.subtle}>No transactions found.</Text>}
            renderItem={({ item }) => (
              <View style={styles.transactionItem}>
                <Text style={styles.infoValue}>{item.description || item.type}</Text>
                <Text style={styles.subtle}>{item.account_name || 'Account'} - {niceDate(item.date)}</Text>
                <Text style={[styles.infoValue, { color: item.type === 'income' ? theme.colors.success : theme.colors.danger }]}>{currency.format(item.amount)}</Text>
              </View>
            )}
          />
          <Pressable style={[styles.primaryButton, { marginTop: theme.spacing.md }]} onPress={() => setPendingAction(null)}><Text style={styles.buttonText}>Close</Text></Pressable>
        </View>
      </Modal>

      <Modal isVisible={pendingAction === 'accounts'} onBackdropPress={() => setPendingAction(null)} style={styles.modal}>
        <View style={[styles.modalCard, { maxHeight: '78%' }]}> 
          <Text style={styles.modalTitle}>User Accounts</Text>
          <FlatList
            data={userAccounts}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={<Text style={styles.subtle}>No accounts found.</Text>}
            renderItem={({ item }) => (
              <View style={styles.transactionItem}>
                <View style={styles.statusRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoValue}>{item.name}</Text>
                    <Text style={styles.subtle}>{item.type} - {item.transaction_count || 0} transactions</Text>
                    <Text style={styles.infoValue}>{currency.format(Number(item.balance || 0))} {item.currency}</Text>
                  </View>
                  <Switch
                    value={Boolean(item.is_active)}
                    onValueChange={() => toggleAccount(item)}
                    trackColor={{ true: theme.colors.success, false: theme.colors.border }}
                    thumbColor={theme.colors.surface}
                  />
                </View>
                {item.is_active ? (
                  <View style={styles.accountActions}>
                    <Pressable style={styles.accountActionButton} onPress={() => toggleAccount(item)}>
                      <Text style={styles.secondaryText}>Close</Text>
                    </Pressable>
                    <Pressable style={[styles.accountActionButton, styles.accountDeleteButton]} onPress={() => startDeleteAccount(item)}>
                      <Text style={[styles.secondaryText, { color: theme.colors.danger }]}>Delete</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            )}
          />
          <Pressable style={[styles.primaryButton, { marginTop: theme.spacing.md }]} onPress={() => setPendingAction(null)}><Text style={styles.buttonText}>Close</Text></Pressable>
        </View>
      </Modal>

      <Modal isVisible={pendingAction === 'deleteAccount'} onBackdropPress={() => setPendingAction('accounts')} style={styles.modal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalCard}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <Text style={styles.modalTitle}>Delete Account</Text>
          <Text style={styles.modalBody}>
            Delete {selectedAccountForDelete?.name || 'this account'} for {user.email}. This is audited with your admin account and reason.
          </Text>
          {(selectedAccountForDelete?.transaction_count || 0) > 0 ? (
            <View style={styles.choiceRow}>
              <Pressable
                style={[styles.choiceButton, accountTransactionAction === 'cash' && styles.choiceButtonActive]}
                onPress={() => setAccountTransactionAction('cash')}
              >
                <Text style={styles.choiceText}>Move transactions to Cash</Text>
              </Pressable>
              <Pressable
                style={[styles.choiceButton, accountTransactionAction === 'delete' && styles.choiceButtonActive]}
                onPress={() => setAccountTransactionAction('delete')}
              >
                <Text style={styles.choiceText}>Delete transactions</Text>
              </Pressable>
            </View>
          ) : null}
          <TextInput
            style={styles.input}
            value={accountDeleteReason}
            onChangeText={setAccountDeleteReason}
            placeholder="Audit reason"
            placeholderTextColor={theme.colors.text.light}
          />
          <View style={styles.modalButtons}>
            <Pressable style={styles.secondaryButton} onPress={() => setPendingAction('accounts')} disabled={isSubmitting}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
            <Pressable style={[styles.primaryButton, styles.dangerButton]} onPress={deleteSelectedAccount} disabled={isSubmitting}>
              {isSubmitting ? <ActivityIndicator color={theme.colors.danger} /> : <Text style={[styles.secondaryText, { color: theme.colors.danger }]}>Delete Account</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal isVisible={supportToken !== null} onBackdropPress={() => setSupportToken(null)} style={styles.modal}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Support Token</Text>
          <Text style={styles.modalBody}>{supportToken?.warning || 'This audited token is only for support reproduction.'}</Text>
          <Text style={styles.subtle}>User: {supportToken?.user?.email || user.email} | Expires: {supportToken?.expires_in || '15m'}</Text>
          <Text selectable style={styles.code}>{supportToken?.accessToken}</Text>
          <Pressable style={styles.primaryButton} onPress={() => setSupportToken(null)}><Text style={styles.buttonText}>Close</Text></Pressable>
        </View>
      </Modal>
    </View>
  );
}
