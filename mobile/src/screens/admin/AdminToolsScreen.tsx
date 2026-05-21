import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect } from '@react-navigation/native';
import { API_BASE_URL } from '../../constants';
import api from '../../services/api';
import { getApiErrorMessage } from '../../services/apiErrors';
import { getTokens } from '../../services/secureStorage';
import { showToast } from '../../components/common/Toast';
import { useTheme } from '../../theme';
import type { FeatherIconName } from '../../utils/icons';

type WritableSettings = {
  max_accounts_per_user?: number;
  default_currency?: string;
  date_format?: string;
  lockout_attempts?: number;
  lockout_minutes?: number;
  password_requires_special?: boolean;
  password_min_length?: number;
  password_reset_url?: string;
  webhook_timeout_ms?: number;
  audit_retention_months?: number;
};
type ConfigResponse = {
  node_env?: string;
  db_path?: string;
  access_token_ttl?: string;
  writable_settings: WritableSettings;
};
type ReportResponse = { monthly_financials: unknown[]; cohorts: unknown[]; categories: unknown[] };
type AuditRetentionResponse = { oldest?: string | null; newest?: string | null; count: number; log_size_mb: number; retention_months: number };
type Announcement = { id: string; title: string; body: string; is_active: number | boolean; created_at: string };
type ApiToken = { id: string; name: string; scopes: string[]; is_active: number | boolean; created_at: string; revoked_at?: string | null };
type Webhook = { id: string; name: string; url: string; event: string; is_active: number | boolean; delivery_count?: number; created_at: string };
type SecurityBlock = { ip: string; blocked_until?: string; expires_at?: string; reason?: string };
type ResultState = { title: string; summary?: string; body: string } | null;

function errorMessage(error: unknown, fallback: string) {
  return getApiErrorMessage(error, fallback);
}

function isEnabled(value: number | boolean | undefined) {
  return value === true || value === 1;
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

function downloadWebBlob(contents: ArrayBuffer, filename: string, mimeType: string) {
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

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function AdminToolsScreen() {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [workingAction, setWorkingAction] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [reports, setReports] = useState<ReportResponse | null>(null);
  const [auditRetention, setAuditRetention] = useState<AuditRetentionResponse | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [securityBlocks, setSecurityBlocks] = useState<SecurityBlock[]>([]);
  const [result, setResult] = useState<ResultState>(null);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [tokenName, setTokenName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookName, setWebhookName] = useState('');
  const [ipAddress, setIpAddress] = useState('');

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    content: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl },
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.md, padding: theme.spacing.md, marginBottom: theme.spacing.md, ...theme.shadows.small },
    title: { color: theme.colors.text.primary, fontSize: theme.typography.lg, fontWeight: '800', marginBottom: theme.spacing.sm },
    subtle: { color: theme.colors.text.secondary, fontSize: theme.typography.sm, lineHeight: 20 },
    meta: { color: theme.colors.text.light, fontSize: theme.typography.xs, marginTop: 2 },
    input: { minHeight: 44, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text.primary, backgroundColor: theme.colors.background, paddingHorizontal: theme.spacing.sm, marginTop: theme.spacing.sm },
    multiline: { height: 82, textAlignVertical: 'top', paddingTop: theme.spacing.sm },
    twoCol: { flexDirection: 'row', gap: theme.spacing.sm },
    half: { flex: 1 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
    action: { width: '48%', minHeight: 76, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.sm, gap: theme.spacing.xs, backgroundColor: theme.colors.background },
    actionDisabled: { opacity: 0.55 },
    actionText: { color: theme.colors.text.primary, fontSize: theme.typography.sm, fontWeight: '800', textAlign: 'center' },
    fullButton: { minHeight: 46, borderRadius: theme.borderRadius.sm, backgroundColor: theme.colors.highlight, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm, paddingHorizontal: theme.spacing.md },
    secondaryButton: { minHeight: 38, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.sm, backgroundColor: theme.colors.background },
    dangerButton: { backgroundColor: theme.colors.danger },
    buttonText: { color: theme.colors.text.inverse, fontSize: theme.typography.md, fontWeight: '800' },
    secondaryText: { color: theme.colors.text.primary, fontSize: theme.typography.sm, fontWeight: '800' },
    code: { color: theme.colors.text.primary, fontSize: theme.typography.xs, marginTop: theme.spacing.sm, backgroundColor: theme.colors.background, borderRadius: theme.borderRadius.sm, padding: theme.spacing.sm },
    row: { borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.spacing.sm, marginTop: theme.spacing.sm, gap: theme.spacing.xs },
    rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: theme.spacing.sm },
    rowTitle: { flex: 1, color: theme.colors.text.primary, fontSize: theme.typography.md, fontWeight: '800' },
    pill: { borderRadius: 999, paddingHorizontal: theme.spacing.sm, paddingVertical: 4, backgroundColor: theme.colors.background },
    pillText: { color: theme.colors.text.secondary, fontSize: theme.typography.xs, fontWeight: '800' },
    rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
    warning: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.warning, backgroundColor: theme.colors.background, padding: theme.spacing.sm, marginBottom: theme.spacing.sm },
    warningText: { flex: 1, color: theme.colors.text.primary, fontSize: theme.typography.sm, lineHeight: 20, fontWeight: '700' },
  }), [theme]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configResponse, reportResponse, retentionResponse, announcementsResponse, tokensResponse, webhooksResponse, blocksResponse] = await Promise.all([
        api.get<ConfigResponse>('/api/admin/system-config'),
        api.get<ReportResponse>('/api/admin/reports'),
        api.get<AuditRetentionResponse>('/api/admin/audit-retention'),
        api.get<{ data: Announcement[] }>('/api/admin/announcements'),
        api.get<{ data: ApiToken[] }>('/api/admin/api-tokens'),
        api.get<{ data: Webhook[] }>('/api/admin/webhooks'),
        api.get<{ data: SecurityBlock[] }>('/api/admin/security-blocks'),
      ]);
      setConfig(configResponse.data);
      setReports(reportResponse.data);
      setAuditRetention(retentionResponse.data);
      setAnnouncements(announcementsResponse.data.data || []);
      setTokens(tokensResponse.data.data || []);
      setWebhooks(webhooksResponse.data.data || []);
      setSecurityBlocks(blocksResponse.data.data || []);
    } catch (error) {
      showToast({ type: 'error', text1: 'Admin tools failed to load', text2: errorMessage(error, 'Please try again.') });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function updateSetting<K extends keyof WritableSettings>(key: K, value: WritableSettings[K]) {
    setConfig((current) => ({
      ...(current || { writable_settings: {} }),
      writable_settings: { ...(current?.writable_settings || {}), [key]: value },
    }));
  }

  async function runAction<T>(label: string, fn: () => Promise<T>, options?: { refresh?: boolean; successText?: string }) {
    setWorkingAction(label);
    try {
      const value = await fn();
      showToast({ type: 'success', text1: options?.successText || label });
      if (options?.refresh !== false) await load();
      return value;
    } catch (error) {
      showToast({ type: 'error', text1: `${label} failed`, text2: errorMessage(error, 'Please try again.') });
      return null;
    } finally {
      setWorkingAction(null);
    }
  }

  async function saveConfig() {
    await runAction('System config updated', async () => {
      const settings = config?.writable_settings || {};
      const payload = {
        ...settings,
        default_currency: String(settings.default_currency || 'USD').trim().toUpperCase(),
        max_accounts_per_user: Number(settings.max_accounts_per_user || 25),
        lockout_attempts: Number(settings.lockout_attempts || 5),
        lockout_minutes: Number(settings.lockout_minutes || 15),
        password_min_length: Number(settings.password_min_length || 8),
        audit_retention_months: Number(settings.audit_retention_months || 24),
        webhook_timeout_ms: Number(settings.webhook_timeout_ms || 5000),
      };
      const response = await api.put<ConfigResponse>('/api/admin/system-config', payload);
      setResult({ title: 'Saved System Config', summary: 'System settings were saved. The JSON below shows the stored values returned by the server.', body: formatJson(response.data.writable_settings) });
    });
  }

  async function runIntegrityCheck() {
    await runAction('Integrity Check', async () => {
      const response = await api.post('/api/admin/database/integrity-check');
      setResult({ title: 'Integrity Check Result', summary: 'The database integrity check finished. Review the JSON rows below if any result is not ok.', body: formatJson(response.data) });
    }, { refresh: false });
  }

  async function vacuumDatabase() {
    Alert.alert('Vacuum database?', 'This runs SQLite VACUUM and records an audit log.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Run',
        style: 'destructive',
        onPress: () => {
          void runAction('Vacuum DB', async () => {
            const response = await api.post('/api/admin/database/vacuum');
            setResult({ title: 'Vacuum Result', summary: 'SQLite VACUUM finished and the action was recorded in the audit log.', body: formatJson(response.data) });
          });
        },
      },
    ]);
  }

  async function exportCsv(type: 'monthly' | 'categories') {
    await runAction(`Export ${type} CSV`, async () => {
      const response = await api.get<string>('/api/admin/reports/export', { params: { type }, responseType: 'text' });
      const filename = `${type}-report-${new Date().toISOString().slice(0, 10)}.csv`;
      const uri = await writeTextFile(filename, String(response.data || ''), 'text/csv');
      if (uri) await shareFile(uri, 'text/csv');
      setResult({ title: 'CSV Export Ready', summary: `The ${type} report export is ready.`, body: filename });
    }, { refresh: false });
  }

  async function downloadBackup() {
    await runAction('Database Backup', async () => {
      const filename = `financeapp-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite.gz`;
      if (Platform.OS === 'web') {
        const response = await api.get<ArrayBuffer>('/api/admin/database/backup', { responseType: 'arraybuffer' });
        downloadWebBlob(response.data, filename, 'application/gzip');
        setResult({ title: 'Database Backup Ready', summary: 'A compressed database backup was prepared for download.', body: filename });
        return;
      }

      const { accessToken } = await getTokens();
      const file = new FileSystem.File(FileSystem.Paths.document, filename);
      const downloaded = await FileSystem.File.downloadFileAsync(`${API_BASE_URL}/api/admin/database/backup`, file, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        idempotent: true,
      });
      await shareFile(downloaded.uri, 'application/gzip');
      setResult({ title: 'Database Backup Ready', summary: 'A compressed database backup was prepared for sharing.', body: filename });
    }, { refresh: false });
  }

  async function purgeOldAudits() {
    const months = Number(config?.writable_settings?.audit_retention_months || auditRetention?.retention_months || 24);
    const beforeDate = new Date();
    beforeDate.setMonth(beforeDate.getMonth() - months);
    Alert.alert('Purge old audit logs?', `This deletes audit logs before ${beforeDate.toLocaleDateString()} and records the purge.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Purge',
        style: 'destructive',
        onPress: () => {
          void runAction('Purge Old Audits', async () => {
            const response = await api.post('/api/admin/audit-retention/purge', { before: beforeDate.toISOString() });
            setResult({ title: 'Audit Purge Result', summary: `Audit logs older than ${beforeDate.toLocaleDateString()} were purged. The JSON below shows the server result.`, body: formatJson(response.data) });
          });
        },
      },
    ]);
  }

  async function createAnnouncement() {
    if (!announcementTitle.trim() || !announcementBody.trim()) {
      showToast({ type: 'error', text1: 'Announcement needs a title and body' });
      return;
    }
    await runAction('Announcement created', async () => {
      const response = await api.post('/api/admin/announcements', { title: announcementTitle.trim(), body: announcementBody.trim(), is_active: true });
      setAnnouncementTitle('');
      setAnnouncementBody('');
      setResult({ title: 'Announcement Created', summary: 'The announcement was created and active users can now receive it.', body: formatJson(response.data) });
    });
  }

  async function toggleAnnouncement(item: Announcement) {
    await runAction(isEnabled(item.is_active) ? 'Announcement deactivated' : 'Announcement activated', async () => {
      await api.put(`/api/admin/announcements/${item.id}`, { is_active: !isEnabled(item.is_active) });
    });
  }

  function deleteAnnouncement(item: Announcement) {
    Alert.alert('Delete announcement?', `"${item.title}" will be removed for every user.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void runAction('Announcement deleted', async () => {
            await api.delete(`/api/admin/announcements/${item.id}`);
          });
        },
      },
    ]);
  }

  async function createToken() {
    if (!tokenName.trim()) {
      showToast({ type: 'error', text1: 'Token name is required' });
      return;
    }
    await runAction('API token created', async () => {
      const response = await api.post<{ id: string; name: string; scopes: string[]; token: string }>('/api/admin/api-tokens', { name: tokenName.trim(), scopes: ['read:users'] });
      setTokenName('');
      setResult({ title: 'Copy API Token Now', summary: 'This token is shown only once. Store it before closing this panel.', body: response.data.token });
    });
  }

  async function revokeToken(item: ApiToken) {
    await runAction('API token revoked', async () => {
      await api.delete(`/api/admin/api-tokens/${item.id}`);
    });
  }

  async function createWebhook() {
    if (!webhookUrl.trim()) {
      showToast({ type: 'error', text1: 'Webhook URL is required' });
      return;
    }
    await runAction('Webhook created', async () => {
      const response = await api.post('/api/admin/webhooks', {
        name: webhookName.trim() || 'Admin webhook',
        url: webhookUrl.trim(),
        event: 'admin_event',
      });
      setWebhookName('');
      setWebhookUrl('');
      setResult({ title: 'Webhook Created', summary: 'The webhook was saved. Delivery attempts will appear in the deliveries view.', body: formatJson(response.data) });
    });
  }

  async function toggleWebhook(item: Webhook) {
    await runAction(isEnabled(item.is_active) ? 'Webhook disabled' : 'Webhook enabled', async () => {
      await api.put(`/api/admin/webhooks/${item.id}`, { is_active: !isEnabled(item.is_active) });
    });
  }

  async function viewWebhookDeliveries(item: Webhook) {
    await runAction('Webhook deliveries loaded', async () => {
      const response = await api.get(`/api/admin/webhooks/${item.id}/deliveries`);
      setResult({ title: `${item.name} Deliveries`, summary: 'Recent webhook delivery attempts are shown below with their response details.', body: formatJson(response.data) });
    }, { refresh: false });
  }

  async function blockIp() {
    if (!ipAddress.trim()) {
      showToast({ type: 'error', text1: 'IP address is required' });
      return;
    }
    await runAction('IP blocked', async () => {
      const response = await api.post('/api/admin/security-blocks', { ip: ipAddress.trim(), duration_minutes: 30 });
      setIpAddress('');
      setResult({ title: 'Security Block Created', summary: `${ipAddress.trim()} was blocked for 30 minutes and the action was audited.`, body: formatJson(response.data) });
    });
  }

  async function clearIp(item: SecurityBlock) {
    await runAction('Security block cleared', async () => {
      await api.delete(`/api/admin/security-blocks/${encodeURIComponent(item.ip)}`);
    });
  }

  const actions: Array<{ icon: FeatherIconName; label: string; run: () => void; danger?: boolean }> = [
    { icon: 'check-circle', label: 'Integrity Check', run: () => { void runIntegrityCheck(); } },
    { icon: 'hard-drive', label: 'Vacuum DB', run: () => { void vacuumDatabase(); }, danger: true },
    { icon: 'file-text', label: 'Monthly CSV', run: () => { void exportCsv('monthly'); } },
    { icon: 'tag', label: 'Category CSV', run: () => { void exportCsv('categories'); } },
    { icon: 'download', label: 'DB Backup', run: () => { void downloadBackup(); } },
    { icon: 'trash-2', label: 'Purge Audits', run: () => { void purgeOldAudits(); }, danger: true },
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {loading && !config ? <ActivityIndicator color={theme.colors.highlight} /> : null}

      <View style={styles.card}>
        <Text style={styles.title}>System Configuration</Text>
        <View style={styles.twoCol}>
          <TextInput style={[styles.input, styles.half]} value={String(config?.writable_settings?.default_currency || 'USD')} onChangeText={(value) => updateSetting('default_currency', value.toUpperCase())} placeholder="Currency" placeholderTextColor={theme.colors.text.light} maxLength={3} />
          <TextInput style={[styles.input, styles.half]} value={String(config?.writable_settings?.max_accounts_per_user || 25)} onChangeText={(value) => updateSetting('max_accounts_per_user', Number(value) || 0)} placeholder="Max accounts" placeholderTextColor={theme.colors.text.light} keyboardType="number-pad" />
        </View>
        <View style={styles.twoCol}>
          <TextInput style={[styles.input, styles.half]} value={String(config?.writable_settings?.lockout_attempts || 5)} onChangeText={(value) => updateSetting('lockout_attempts', Number(value) || 0)} placeholder="Lock attempts" placeholderTextColor={theme.colors.text.light} keyboardType="number-pad" />
          <TextInput style={[styles.input, styles.half]} value={String(config?.writable_settings?.lockout_minutes || 15)} onChangeText={(value) => updateSetting('lockout_minutes', Number(value) || 0)} placeholder="Lock minutes" placeholderTextColor={theme.colors.text.light} keyboardType="number-pad" />
        </View>
        <View style={styles.twoCol}>
          <TextInput style={[styles.input, styles.half]} value={String(config?.writable_settings?.password_min_length || 8)} onChangeText={(value) => updateSetting('password_min_length', Number(value) || 0)} placeholder="Password length" placeholderTextColor={theme.colors.text.light} keyboardType="number-pad" />
          <TextInput style={[styles.input, styles.half]} value={String(config?.writable_settings?.audit_retention_months || 24)} onChangeText={(value) => updateSetting('audit_retention_months', Number(value) || 0)} placeholder="Audit months" placeholderTextColor={theme.colors.text.light} keyboardType="number-pad" />
        </View>
        <TextInput style={styles.input} value={String(config?.writable_settings?.date_format || '')} onChangeText={(value) => updateSetting('date_format', value)} placeholder="Date format" placeholderTextColor={theme.colors.text.light} />
        <TextInput style={styles.input} value={String(config?.writable_settings?.password_reset_url || '')} onChangeText={(value) => updateSetting('password_reset_url', value)} placeholder="Password reset URL" placeholderTextColor={theme.colors.text.light} autoCapitalize="none" />
        <Pressable style={styles.fullButton} onPress={saveConfig} disabled={workingAction !== null}>
          <Feather name="save" size={17} color={theme.colors.text.inverse} />
          <Text style={styles.buttonText}>Save Config</Text>
        </Pressable>
        <Text style={styles.meta}>Env: {config?.node_env || 'unknown'} | Access token: {config?.access_token_ttl || 'unknown'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Database & Retention</Text>
        <Text style={styles.subtle}>Audit rows: {auditRetention?.count ?? 0} | Logs: {auditRetention?.log_size_mb ?? 0} MB | Retention: {auditRetention?.retention_months ?? config?.writable_settings?.audit_retention_months ?? 0} months</Text>
        <View style={styles.grid}>
          {actions.map((action) => (
            <Pressable key={action.label} style={[styles.action, action.danger && styles.dangerButton, workingAction !== null && styles.actionDisabled]} onPress={action.run} disabled={workingAction !== null}>
              <Feather name={action.icon} size={22} color={action.danger ? theme.colors.text.inverse : theme.colors.highlight} />
              <Text style={[styles.actionText, action.danger && { color: theme.colors.text.inverse }]}>{workingAction === action.label ? 'Working...' : action.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {result ? (
        <View style={styles.card}>
          <View style={styles.rowHeader}>
            <Text style={styles.title}>{result.title}</Text>
            <Pressable onPress={() => setResult(null)}><Feather name="x" size={22} color={theme.colors.text.primary} /></Pressable>
          </View>
          {result.summary ? <Text style={styles.subtle}>{result.summary}</Text> : null}
          <Text selectable style={styles.code}>{result.body}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.title}>Advanced Reports</Text>
        <Text style={styles.subtle}>Monthly: {reports?.monthly_financials.length || 0} | Cohorts: {reports?.cohorts.length || 0} | Categories: {reports?.categories.length || 0}</Text>
        <Text style={styles.code} numberOfLines={6}>{formatJson(reports?.monthly_financials?.[0] || {})}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Announcements</Text>
        <TextInput style={styles.input} value={announcementTitle} onChangeText={setAnnouncementTitle} placeholder="Title" placeholderTextColor={theme.colors.text.light} />
        <TextInput style={[styles.input, styles.multiline]} value={announcementBody} onChangeText={setAnnouncementBody} placeholder="Body" placeholderTextColor={theme.colors.text.light} multiline />
        <Pressable style={styles.fullButton} onPress={createAnnouncement} disabled={workingAction !== null}><Text style={styles.buttonText}>Create Announcement</Text></Pressable>
        {announcements.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <View style={styles.pill}><Text style={styles.pillText}>{isEnabled(item.is_active) ? 'Active' : 'Inactive'}</Text></View>
            </View>
            <Text style={styles.subtle} numberOfLines={2}>{item.body}</Text>
            <View style={styles.rowActions}>
              <Pressable style={styles.secondaryButton} onPress={() => { void toggleAnnouncement(item); }} disabled={workingAction !== null}>
                <Text style={styles.secondaryText}>{isEnabled(item.is_active) ? 'Deactivate' : 'Activate'}</Text>
              </Pressable>
              <Pressable style={[styles.secondaryButton, styles.dangerButton]} onPress={() => { deleteAnnouncement(item); }} disabled={workingAction !== null}>
                <Feather name="trash-2" size={16} color={theme.colors.text.inverse} />
                <Text style={styles.buttonText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>API Tokens</Text>
        <TextInput style={styles.input} value={tokenName} onChangeText={setTokenName} placeholder="Token name" placeholderTextColor={theme.colors.text.light} />
        <Pressable style={styles.fullButton} onPress={createToken} disabled={workingAction !== null}><Text style={styles.buttonText}>Create Read Token</Text></Pressable>
        {tokens.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <View style={styles.pill}><Text style={styles.pillText}>{isEnabled(item.is_active) ? 'Active' : 'Revoked'}</Text></View>
            </View>
            <Text style={styles.meta}>{item.scopes.join(', ') || 'No scopes'}</Text>
            {isEnabled(item.is_active) ? (
              <View style={styles.rowActions}>
                <Pressable style={[styles.secondaryButton, styles.dangerButton]} onPress={() => { void revokeToken(item); }} disabled={workingAction !== null}>
                  <Text style={styles.buttonText}>Revoke</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Webhooks</Text>
        <View style={styles.warning}>
          <Feather name="alert-triangle" size={18} color={theme.colors.warning} />
          <Text style={styles.warningText}>This webhook will receive raw authentication tokens. Only configure this with trusted, secured, HTTPS endpoints.</Text>
        </View>
        <TextInput style={styles.input} value={webhookName} onChangeText={setWebhookName} placeholder="Webhook name" placeholderTextColor={theme.colors.text.light} />
        <TextInput style={styles.input} value={webhookUrl} onChangeText={setWebhookUrl} placeholder="https://example.com/webhook" placeholderTextColor={theme.colors.text.light} autoCapitalize="none" />
        <Pressable style={styles.fullButton} onPress={createWebhook} disabled={workingAction !== null}><Text style={styles.buttonText}>Create Webhook</Text></Pressable>
        {webhooks.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <View style={styles.pill}><Text style={styles.pillText}>{isEnabled(item.is_active) ? 'Active' : 'Inactive'}</Text></View>
            </View>
            <Text style={styles.subtle}>{item.event} | {item.url}</Text>
            <Text style={styles.meta}>{item.delivery_count || 0} deliveries</Text>
            <View style={styles.rowActions}>
              <Pressable style={styles.secondaryButton} onPress={() => { void toggleWebhook(item); }} disabled={workingAction !== null}><Text style={styles.secondaryText}>{isEnabled(item.is_active) ? 'Disable' : 'Enable'}</Text></Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => { void viewWebhookDeliveries(item); }} disabled={workingAction !== null}><Text style={styles.secondaryText}>Deliveries</Text></Pressable>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Account Safety</Text>
        <TextInput style={styles.input} value={ipAddress} onChangeText={setIpAddress} placeholder="IP address to block" placeholderTextColor={theme.colors.text.light} autoCapitalize="none" />
        <Pressable style={styles.fullButton} onPress={blockIp} disabled={workingAction !== null}><Text style={styles.buttonText}>Block IP for 30 Minutes</Text></Pressable>
        {securityBlocks.map((item) => (
          <View key={item.ip} style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle}>{item.ip}</Text>
              <View style={styles.pill}><Text style={styles.pillText}>Blocked</Text></View>
            </View>
            <Text style={styles.meta}>Until: {item.blocked_until || item.expires_at || 'unknown'}</Text>
            <View style={styles.rowActions}>
              <Pressable style={styles.secondaryButton} onPress={() => { void clearIp(item); }} disabled={workingAction !== null}><Text style={styles.secondaryText}>Clear Block</Text></Pressable>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
