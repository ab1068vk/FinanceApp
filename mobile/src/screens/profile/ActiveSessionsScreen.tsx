import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import { ProfileStackParamList } from '../../navigation';
import api from '../../services/api';
import { getTokens } from '../../services/secureStorage';
import { showToast } from '../../components/common/Toast';

type Props = StackScreenProps<ProfileStackParamList, 'ActiveSessions'>;

type ActiveSession = {
  id: string;
  created_at: string;
  expires_at: string;
  last_used_at?: string | null;
  user_agent?: string | null;
  device_hint?: string | null;
};

type SessionsResponse = {
  active_sessions: number;
  sessions: ActiveSession[];
};

function formatDate(value?: string | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

export default function ActiveSessionsScreen({ navigation }: Props) {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const loadSessions = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const response = await api.get<SessionsResponse>('/api/auth/sessions', { signal });
      setSessions(response.data.sessions);
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === 'CanceledError') return;
      setError('Unable to load active sessions.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadSessions(controller.signal);
    return () => controller.abort();
  }, [loadSessions]);

  const refresh = () => {
    setIsRefreshing(true);
    loadSessions();
  };

  const revokeSession = (sessionId: string) => {
    Alert.alert('Revoke session?', 'That device will need to sign in again after its current access expires.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          setRevokingId(sessionId);
          try {
            await api.delete(`/api/auth/sessions/${sessionId}`);
            setSessions((current) => current.filter((session) => session.id !== sessionId));
            showToast({ type: 'success', text1: 'Session revoked' });
          } catch (revokeError) {
            showToast({ type: 'error', text1: 'Revoke failed', text2: revokeError instanceof Error ? revokeError.message : 'Please try again.' });
          } finally {
            setRevokingId(null);
          }
        },
      },
    ]);
  };

  const revokeOtherSessions = () => {
    Alert.alert('Revoke all other sessions?', 'Every other signed-in device will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke Others',
        style: 'destructive',
        onPress: async () => {
          setRevokingOthers(true);
          try {
            const { refreshToken } = await getTokens();
            if (!refreshToken) throw new Error('Missing current session token.');
            const response = await api.delete<{ revoked: number }>('/api/auth/sessions/others', { data: { refreshToken } });
            showToast({ type: 'success', text1: 'Other sessions revoked', text2: `${response.data.revoked} session${response.data.revoked === 1 ? '' : 's'} revoked.` });
            await loadSessions();
          } catch (revokeError) {
            showToast({ type: 'error', text1: 'Revoke failed', text2: revokeError instanceof Error ? revokeError.message : 'Please try again.' });
          } finally {
            setRevokingOthers(false);
          }
        },
      },
    ]);
  };

  const renderSession = ({ item }: { item: ActiveSession }) => (
    <View style={styles.sessionCard}>
      <View style={styles.sessionHeader}>
        <View style={styles.deviceIcon}>
          <Feather name="smartphone" size={22} color="#0F3460" />
        </View>
        <View style={styles.sessionTitleBlock}>
          <Text style={styles.deviceLabel} numberOfLines={2}>{item.device_hint || item.user_agent || 'Unknown device'}</Text>
          <Text style={styles.sessionMeta}>Created {formatDate(item.created_at)}</Text>
        </View>
      </View>

      <View style={styles.details}>
        <InfoRow label="Last used" value={formatDate(item.last_used_at)} />
        <InfoRow label="Expires" value={formatDate(item.expires_at)} />
      </View>

      <TouchableOpacity
        style={[styles.revokeButton, revokingId === item.id && styles.disabledButton]}
        disabled={revokingId === item.id}
        onPress={() => revokeSession(item.id)}
      >
        {revokingId === item.id ? <ActivityIndicator color="#E74C3C" /> : <Feather name="x-circle" size={18} color="#E74C3C" />}
        <Text style={styles.revokeText}>{revokingId === item.id ? 'Revoking' : 'Revoke'}</Text>
      </TouchableOpacity>
    </View>
  );

  if (isLoading) {
    return <CenteredState icon="loader" title="Loading sessions" message="Checking signed-in devices..." loading />;
  }

  if (error) {
    return <CenteredState icon="alert-circle" title="Sessions unavailable" message={error} actionLabel="Retry" onAction={refresh} />;
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderSession}
        contentContainerStyle={sessions.length ? styles.listContent : styles.emptyContent}
        onRefresh={refresh}
        refreshing={isRefreshing}
        getItemLayout={(_, index) => ({ length: 178, offset: 178 * index, index })}
        ListHeaderComponent={sessions.length ? (
          <TouchableOpacity
            style={[styles.revokeOthersButton, revokingOthers && styles.disabledButton]}
            disabled={revokingOthers}
            onPress={revokeOtherSessions}
          >
            {revokingOthers ? <ActivityIndicator color="#FFFFFF" /> : <Feather name="shield-off" size={18} color="#FFFFFF" />}
            <Text style={styles.revokeOthersText}>{revokingOthers ? 'Revoking Sessions' : 'Revoke All Other Sessions'}</Text>
          </TouchableOpacity>
        ) : null}
        ListEmptyComponent={(
          <CenteredState
            icon="smartphone"
            title="No active sessions"
            message="No refresh sessions were found for this account."
            actionLabel="Back to Settings"
            onAction={() => navigation.goBack()}
          />
        )}
      />
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function CenteredState({ icon, title, message, actionLabel, onAction, loading = false }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}) {
  return (
    <View style={styles.centered}>
      <View style={styles.centeredIcon}>{loading ? <ActivityIndicator color="#E94560" /> : <Feather name={icon} size={28} color="#0F3460" />}</View>
      <Text style={styles.centeredTitle}>{title}</Text>
      <Text style={styles.centeredMessage}>{message}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.retryButton} onPress={onAction}>
          <Text style={styles.retryText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  listContent: { padding: 20, paddingBottom: 34 },
  emptyContent: { flexGrow: 1 },
  sessionCard: { minHeight: 160, borderRadius: 16, backgroundColor: '#FFFFFF', padding: 16, marginBottom: 14 },
  sessionHeader: { flexDirection: 'row', alignItems: 'center' },
  deviceIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#0F346014', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  sessionTitleBlock: { flex: 1, minWidth: 0 },
  deviceLabel: { color: '#1A1A2E', fontSize: 15, fontWeight: '900' },
  sessionMeta: { color: '#6C757D', fontSize: 12, fontWeight: '700', marginTop: 4 },
  details: { marginTop: 14, gap: 8 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoLabel: { color: '#6C757D', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  infoValue: { color: '#1A1A2E', fontSize: 13, fontWeight: '800', flex: 1, textAlign: 'right' },
  revokeButton: { height: 42, borderRadius: 12, borderWidth: 1, borderColor: '#E74C3C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 },
  revokeText: { color: '#E74C3C', fontSize: 14, fontWeight: '900' },
  revokeOthersButton: { height: 50, borderRadius: 14, backgroundColor: '#E94560', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  revokeOthersText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  disabledButton: { opacity: 0.6 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#F8F9FA' },
  centeredIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  centeredTitle: { color: '#1A1A2E', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  centeredMessage: { color: '#6C757D', fontSize: 14, fontWeight: '700', textAlign: 'center', lineHeight: 20, marginTop: 8 },
  retryButton: { height: 44, borderRadius: 12, backgroundColor: '#0F3460', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 18 },
  retryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
