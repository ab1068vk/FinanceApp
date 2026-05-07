import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import { budgetsActions, fetchBudgets } from '../../store';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { accountsActions, Account, fetchAccounts } from '../../store/slices/accountsSlice';
import { fetchTransactions, Transaction, transactionsActions } from '../../store/slices/transactionsSlice';
import { logoutUser } from '../../store/slices/authSlice';
import { ProfileStackParamList } from '../../navigation';
import api from '../../services/api';
import { AppSettings, defaultSettings, loadAppSettings, saveAppSettings, ThemeMode } from '../../services/appSettings';
import { getBiometricPreference, setBiometricPreference } from '../../services/biometrics';
import { AutoLockPreference, getAutoLockPreference, setAutoLockPreference } from '../../services/sessionLock';
import { useTheme } from '../../theme';
import type { FeatherIconName } from '../../utils/icons';
import { ListPayload, unwrapList } from '../../types/api';
import { getQueue } from '../../utils/offlineQueue';

type Props = StackScreenProps<ProfileStackParamList, 'Settings'>;
type CategoryExport = { id: string; name: string; type: string; color?: string | null; icon?: string | null };
type SessionSummary = { active_sessions: number; sessions: Array<{ id: string; created_at: string; expires_at: string }> };

function csvCell(value: unknown) {
  const text = String(value ?? '');
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safeText) ? `"${safeText.replace(/"/g, '""')}"` : safeText;
}

function csvRow(values: unknown[]) {
  return values.map(csvCell).join(',');
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

function buildExportCsv(payload: { accounts: Account[]; transactions: Transaction[]; budgets: unknown[]; categories: CategoryExport[] }) {
  const budgetRows = payload.budgets as Array<Record<string, unknown>>;
  const rows = [
    csvRow(['FinanceApp Export']),
    csvRow(['Generated At', new Date().toISOString()]),
    '',
    csvRow(['Accounts']),
    csvRow(['Name', 'Type', 'Currency', 'Starting Balance', 'Current Balance', 'Active']),
    ...payload.accounts.map((account) => csvRow([account.name, account.type, account.currency, account.balance, account.current_balance ?? account.balance, account.is_active])),
    '',
    csvRow(['Transactions']),
    csvRow(['Date', 'Type', 'Account', 'Category', 'Description', 'Amount', 'Note']),
    ...payload.transactions.map((transaction) => csvRow([
      transaction.date,
      transaction.type,
      transaction.account_name || transaction.account_id || '',
      transaction.category_name || transaction.category_id || '',
      transaction.description || '',
      transaction.amount,
      transaction.note || '',
    ])),
    '',
    csvRow(['Budgets']),
    csvRow(['Category', 'Amount', 'Current Spending', 'Start Date', 'End Date']),
    ...budgetRows.map((budget) => csvRow([budget.category_name || budget.category_id || '', budget.amount, budget.current_spending, budget.start_date, budget.end_date])),
    '',
    csvRow(['Categories']),
    csvRow(['Name', 'Type', 'Color', 'Icon']),
    ...payload.categories.map((category) => csvRow([category.name, category.type, category.color || '', category.icon || ''])),
  ];

  return rows.join('\n');
}

export default function SettingsScreen({ navigation }: Props) {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [sessions, setSessions] = useState<SessionSummary | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountVisible, setDeleteAccountVisible] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);

  const loadProfileData = useCallback(async () => {
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const [storedSettings, autoLock, biometricPreference, sessionResponse] = await Promise.all([
        loadAppSettings(),
        getAutoLockPreference(),
        getBiometricPreference(),
        api.get<SessionSummary>('/api/auth/sessions'),
        dispatch(fetchAccounts()).unwrap(),
        dispatch(fetchTransactions({ page: 1, limit: 20 })).unwrap(),
        dispatch(fetchBudgets()).unwrap(),
      ]);
      setSettings({ ...storedSettings, autoLock });
      setBiometricEnabled(biometricPreference);
      setSessions(sessionResponse.data);
      setPendingQueueCount((await getQueue()).length);
    } catch {
      setLoadError('Unable to refresh profile settings.');
      showToast({ type: 'error', text1: 'Profile refresh failed' });
    } finally {
      setIsRefreshing(false);
    }
  }, [dispatch]);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  const persistSettings = useCallback(async (updates: Partial<AppSettings>) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    await saveAppSettings(next);
  }, [settings]);

  const chooseThemeMode = async (mode: ThemeMode) => {
    theme.setThemeMode(mode);
    await persistSettings({ themeMode: mode });
  };

  const toggleBiometricUnlock = async (enabled: boolean) => {
    try {
      await setBiometricPreference(enabled);
      setBiometricEnabled(enabled);
      showToast({ type: 'success', text1: enabled ? 'Biometric unlock enabled' : 'Biometric unlock disabled' });
    } catch (error) {
      showToast({ type: 'error', text1: 'Biometric setting failed', text2: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const chooseAutoLock = async (autoLock: AutoLockPreference) => {
    await setAutoLockPreference(autoLock);
    await persistSettings({ autoLock });
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const [accountResponse, transactionResponse, budgetResponse, categoryResponse] = await Promise.all([
        api.get<ListPayload<Account>>('/api/accounts', { params: { page: 1, limit: 200 } }),
        api.get<{ data: Transaction[] }>('/api/transactions', { params: { page: 1, limit: 1000 } }),
        api.get<ListPayload<Record<string, unknown>>>('/api/budgets', { params: { page: 1, limit: 200 } }),
        api.get<ListPayload<CategoryExport>>('/api/categories', { params: { page: 1, limit: 200 } }),
      ]);
      const csv = buildExportCsv({
        accounts: unwrapList(accountResponse.data),
        transactions: transactionResponse.data.data,
        budgets: unwrapList(budgetResponse.data),
        categories: unwrapList(categoryResponse.data),
      });
      const filename = `financeapp-export-${new Date().toISOString().slice(0, 10)}.csv`;
      const uri = await writeTextFile(filename, csv, 'text/csv;charset=utf-8');
      if (uri) await shareFile(uri, 'text/csv');
      showToast({ type: 'success', text1: 'Export ready', text2: Platform.OS === 'web' ? filename : 'Choose where to save or share it.' });
    } catch (error) {
      showToast({ type: 'error', text1: 'Export failed', text2: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setExporting(false);
    }
  };

  const exportMyData = async () => {
    setExportingJson(true);
    try {
      const response = await api.get<Record<string, unknown>>('/api/auth/data');
      const json = JSON.stringify(response.data, null, 2);
      const filename = `financeapp-data-${new Date().toISOString().slice(0, 10)}.json`;
      const uri = await writeTextFile(filename, json, 'application/json;charset=utf-8');
      if (uri) await shareFile(uri, 'application/json');
      showToast({ type: 'success', text1: 'Export ready', text2: Platform.OS === 'web' ? filename : 'Choose where to save or share it.' });
    } catch (error) {
      showToast({ type: 'error', text1: 'Export failed', text2: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setExportingJson(false);
    }
  };

  const clearCache = () => {
    dispatch(accountsActions.setAccounts([]));
    dispatch(accountsActions.setSelectedAccount(null));
    dispatch(transactionsActions.setTransactions({ transactions: [] }));
    dispatch(budgetsActions.setBudgets([]));
    showToast({ type: 'success', text1: 'Local cache cleared', text2: 'Pull to refresh when you want to reload data.' });
  };

  const deleteAllData = () => {
    Alert.alert(
      'Delete all financial data?',
      'This deletes your accounts, transactions, budgets, and custom categories. Your login stays active.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete('/api/auth/data');
              dispatch(accountsActions.setAccounts([]));
              dispatch(accountsActions.setSelectedAccount(null));
              dispatch(transactionsActions.setTransactions({ transactions: [] }));
              dispatch(budgetsActions.setBudgets([]));
              await dispatch(fetchAccounts()).unwrap();
              showToast({ type: 'success', text1: 'Financial data deleted' });
            } catch (error) {
              showToast({ type: 'error', text1: 'Delete failed', text2: error instanceof Error ? error.message : 'Please try again.' });
            }
          },
        },
      ],
    );
  };

  const deleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') return;
    setDeletingAccount(true);
    try {
      await api.delete('/api/auth/account', { data: { confirmation: deleteConfirmation } });
      setDeleteAccountVisible(false);
      setDeleteConfirmation('');
      showToast({ type: 'success', text1: 'Account deleted' });
      await dispatch(logoutUser()).unwrap();
    } catch (error) {
      showToast({ type: 'error', text1: 'Delete failed', text2: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setDeletingAccount(false);
    }
  };

  const showLegal = (title: string, message: string) => {
    Alert.alert(title, message, [{ text: 'OK' }]);
  };

  const contactSupport = async () => {
    const url = `mailto:support@financeapp.local?subject=${encodeURIComponent('FinanceApp Support')}`;
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return;
    }
    Alert.alert('Contact Support', 'Email support@financeapp.local with your account email and a short description of the issue.');
  };

  const signOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to access FinanceApp.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => dispatch(logoutUser()) },
    ]);
  };

  const sessionValue = useMemo(() => {
    if (!sessions) return 'Refresh';
    return `${sessions.active_sessions} active`;
  }, [sessions]);

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={loadProfileData} tintColor="#E94560" colors={['#E94560']} />}
      >
        {loadError ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={18} color="#E74C3C" />
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        ) : null}
        {isRefreshing ? <ActivityIndicator color="#E94560" style={styles.loader} /> : null}

        <View style={styles.settingsArea}>
          <SettingsGroup title="Account">
            <SettingsRow icon="user" label="Edit Profile" onPress={() => navigation.navigate('EditProfile')} />
            <SettingsRow icon="lock" label="Change Password" onPress={() => navigation.navigate('ChangePassword')} />
            <SettingsRow
              icon="bell"
              label="Budget Alerts"
              right={<Switch value={settings.budgetAlerts} onValueChange={(budgetAlerts) => persistSettings({ budgetAlerts })} trackColor={{ true: '#E94560' }} />}
              last
            />
          </SettingsGroup>

          <SettingsGroup title="Display">
            <View style={styles.themeRow}>
              <View style={styles.themeLabelBlock}><Feather name="sun" size={20} color="#0F3460" /><Text style={styles.rowLabel}>Theme</Text></View>
              <View style={styles.themeToggle}>{(['Light', 'Dark', 'System'] as ThemeMode[]).map((mode) => (
                <TouchableOpacity key={mode} style={[styles.themePill, settings.themeMode === mode && styles.themePillActive]} onPress={() => chooseThemeMode(mode)}>
                  <Text style={[styles.themePillText, settings.themeMode === mode && styles.themePillTextActive]}>{mode}</Text>
                </TouchableOpacity>
              ))}</View>
            </View>
          </SettingsGroup>

          <SettingsGroup title="Security">
            <SettingsRow icon="smartphone" label="Active Sessions" value={sessionValue} onPress={() => navigation.navigate('ActiveSessions')} />
            <SettingsRow
              icon="lock"
              label="Biometric Unlock"
              right={<Switch value={biometricEnabled} onValueChange={toggleBiometricUnlock} trackColor={{ true: '#E94560' }} />}
            />
            <View style={styles.autoLockRow}>
              <View style={styles.themeLabelBlock}><Feather name="clock" size={20} color="#0F3460" /><Text style={styles.rowLabel}>Auto-Lock</Text></View>
              <View style={styles.autoLockToggle}>{(['1 min', '5 min', '15 min', 'Never'] as AutoLockPreference[]).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.autoLockPill, settings.autoLock === mode && styles.themePillActive]}
                  onPress={() => chooseAutoLock(mode)}
                  accessibilityRole="button"
                  accessibilityLabel={`Set auto-lock timeout to ${mode}`}
                >
                  <Text style={[styles.themePillText, settings.autoLock === mode && styles.themePillTextActive]}>{mode}</Text>
                </TouchableOpacity>
              ))}</View>
            </View>
          </SettingsGroup>

          <SettingsGroup title="Data">
            <SettingsRow icon="upload-cloud" label="Offline Queue" value={`${pendingQueueCount} pending`} onPress={() => navigation.navigate('OfflineQueue')} />
            <SettingsRow icon="tag" label="Categories" onPress={() => navigation.navigate('Categories')} />
            <SettingsRow icon="download" label="Export Data" value={exporting ? 'Exporting' : 'CSV'} onPress={exporting ? undefined : exportData} />
            <SettingsRow icon="trash" label="Clear Local Cache" onPress={clearCache} />
            <SettingsRow icon="alert-triangle" label="Delete All Financial Data" onPress={deleteAllData} last />
          </SettingsGroup>

          <SettingsGroup title="Privacy">
            <View style={styles.privacySummary}>
              <Text style={styles.privacyText}>FinanceApp stores your profile, accounts, transactions, budgets, categories, sessions, and security audit records to run your account and protect access.</Text>
            </View>
            <SettingsRow icon="download-cloud" label="Export My Data" value={exportingJson ? 'Exporting' : 'JSON'} onPress={exportingJson ? undefined : exportMyData} />
            <SettingsRow icon="user-x" label="Delete My Account" onPress={() => setDeleteAccountVisible(true)} last />
          </SettingsGroup>

          <SettingsGroup title="About">
            <SettingsRow icon="info" label="App Version" value="1.0.0" />
            <SettingsRow icon="shield" label="Privacy Policy" onPress={() => showLegal('Privacy Policy', 'FinanceApp stores your signed-in session on this device and sends your financial records only to your configured FinanceApp backend. Exports are created locally on your device.')} />
            <SettingsRow icon="file-text" label="Terms of Service" onPress={() => showLegal('Terms of Service', 'Use FinanceApp to track your own financial records. You are responsible for reviewing entries, exports, and account data before relying on them.')} />
            <SettingsRow icon="mail" label="Contact Support" onPress={contactSupport} last />
          </SettingsGroup>

          <TouchableOpacity style={styles.logoutButton} onPress={signOut}>
            <Feather name="log-out" size={20} color="#E74C3C" />
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <Modal visible={deleteAccountVisible} transparent animationType="fade" onRequestClose={() => setDeleteAccountVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete account?</Text>
            <Text style={styles.modalText}>This will permanently delete all your data and cannot be undone.</Text>
            <Text style={styles.modalText}>Type DELETE to confirm.</Text>
            <TextInput
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
              autoCapitalize="characters"
              placeholder="DELETE"
              placeholderTextColor="#ADB5BD"
              style={styles.confirmInput}
              editable={!deletingAccount}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setDeleteAccountVisible(false);
                  setDeleteConfirmation('');
                }}
                disabled={deletingAccount}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteButton, (deleteConfirmation !== 'DELETE' || deletingAccount) && styles.deleteButtonDisabled]}
                onPress={deleteAccount}
                disabled={deleteConfirmation !== 'DELETE' || deletingAccount}
              >
                {deletingAccount ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.deleteText}>Delete</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return <View style={styles.statCard}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.group}><Text style={styles.groupTitle}>{title}</Text><View style={styles.groupCard}>{children}</View></View>;
}

function SettingsRow({ icon, label, value, right, onPress, last = false }: { icon: FeatherIconName; label: string; value?: string; right?: React.ReactNode; onPress?: () => void; last?: boolean }) {
  return (
    <TouchableOpacity style={[styles.row, last && styles.lastRow, !onPress && !right && styles.staticRow]} onPress={onPress} activeOpacity={onPress ? 0.75 : 1} disabled={!onPress && !right}>
      <View style={styles.rowLeft}><View style={styles.rowIcon}><Feather name={icon} size={20} color="#0F3460" /></View><Text style={styles.rowLabel}>{label}</Text></View>
      {right || <View style={styles.rowRight}>{value ? <Text style={styles.rowValue}>{value}</Text> : null}{onPress ? <Feather name="chevron-right" size={20} color="#ADB5BD" /> : null}</View>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { paddingBottom: 34 },
  header: { height: 200, backgroundColor: '#1A1A2E', alignItems: 'center', justifyContent: 'center', paddingTop: 24 },
  editButton: { position: 'absolute', top: 52, right: 22, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.24)' },
  avatarText: { color: '#FFFFFF', fontSize: 28, fontWeight: '900' },
  fullName: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', marginTop: 12 },
  email: { color: '#ADB5BD', fontSize: 14, marginTop: 5 },
  loader: { marginTop: 14 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#FDECEC', padding: 12, marginHorizontal: 20, marginTop: 14 },
  errorText: { color: '#E74C3C', fontSize: 13, fontWeight: '800', flex: 1 },
  statsBridge: { flexDirection: 'row', gap: 10, marginTop: -28, paddingHorizontal: 20 },
  statCard: { flex: 1, height: 78, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  statValue: { color: '#1A1A2E', fontSize: 22, fontWeight: '900' },
  statLabel: { color: '#6C757D', fontSize: 12, fontWeight: '800', marginTop: 4 },
  settingsArea: { paddingHorizontal: 20, paddingTop: 18 },
  group: { marginTop: 22 },
  groupTitle: { color: '#6C757D', fontSize: 13, fontWeight: '900', marginBottom: 8, textTransform: 'uppercase' },
  groupCard: { borderRadius: 16, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  row: { minHeight: 58, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#F1F3F5' },
  staticRow: { opacity: 0.92 },
  lastRow: { borderBottomWidth: 0 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  rowIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0F346014', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rowLabel: { color: '#1A1A2E', fontSize: 15, fontWeight: '800', flexShrink: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
  rowValue: { color: '#6C757D', fontSize: 13, fontWeight: '800', marginRight: 6 },
  themeRow: { minHeight: 66, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  themeLabelBlock: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  themeToggle: { flexDirection: 'row', backgroundColor: '#F5F5F5', borderRadius: 999, padding: 3 },
  themePill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  autoLockRow: { minHeight: 70, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  autoLockToggle: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4, flex: 1, marginLeft: 10 },
  autoLockPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 7, backgroundColor: '#F5F5F5' },
  themePillActive: { backgroundColor: '#E94560' },
  themePillText: { color: '#6C757D', fontSize: 12, fontWeight: '900' },
  themePillTextActive: { color: '#FFFFFF' },
  logoutButton: { height: 54, borderRadius: 14, borderWidth: 1.5, borderColor: '#E74C3C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  logoutText: { color: '#E74C3C', fontSize: 16, fontWeight: '900', marginLeft: 8 },
  privacySummary: { paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F3F5' },
  privacyText: { color: '#6C757D', fontSize: 13, fontWeight: '700', lineHeight: 19 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  modalCard: { width: '100%', maxWidth: 420, borderRadius: 16, backgroundColor: '#FFFFFF', padding: 20 },
  modalTitle: { color: '#1A1A2E', fontSize: 20, fontWeight: '900' },
  modalText: { color: '#6C757D', fontSize: 14, fontWeight: '700', lineHeight: 20, marginTop: 10 },
  confirmInput: { height: 48, borderRadius: 12, backgroundColor: '#F8F9FA', color: '#1A1A2E', fontSize: 16, fontWeight: '900', paddingHorizontal: 14, marginTop: 16 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelButton: { flex: 1, height: 46, borderRadius: 12, backgroundColor: '#F1F3F5', alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: '#1A1A2E', fontSize: 14, fontWeight: '900' },
  deleteButton: { flex: 1, height: 46, borderRadius: 12, backgroundColor: '#E74C3C', alignItems: 'center', justifyContent: 'center' },
  deleteButtonDisabled: { opacity: 0.5 },
  deleteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
