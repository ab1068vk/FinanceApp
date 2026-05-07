import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { showToast } from '../../components/common/Toast';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { processOfflineQueue } from '../../hooks/useOfflineQueue';
import { clearQueue, getQueue, QueuedMutation } from '../../utils/offlineQueue';

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export default function OfflineQueueScreen() {
  const dispatch = useAppDispatch();
  const isOnline = useAppSelector((state) => state.ui.isOnline);
  const [queue, setQueue] = useState<QueuedMutation[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const loadQueue = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setQueue(await getQueue());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const retryNow = async () => {
    if (!isOnline) {
      showToast({ type: 'info', text1: 'Still offline', text2: 'Reconnect before retrying sync.' });
      return;
    }
    setIsRetrying(true);
    try {
      await processOfflineQueue(dispatch);
      await loadQueue();
      showToast({ type: 'success', text1: 'Offline changes synced' });
    } catch (error) {
      await loadQueue();
      showToast({ type: 'error', text1: 'Sync paused', text2: error instanceof Error ? error.message : 'The first pending change failed.' });
    } finally {
      setIsRetrying(false);
    }
  };

  const confirmClear = () => {
    Alert.alert(
      'Clear offline queue?',
      'This will discard unsynced changes. They cannot be recovered.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Queue',
          style: 'destructive',
          onPress: async () => {
            await clearQueue();
            await loadQueue();
            showToast({ type: 'success', text1: 'Offline queue cleared' });
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.summary}>
        <View style={styles.summaryIcon}><Feather name="upload-cloud" size={24} color="#0F3460" /></View>
        <View style={styles.summaryTextBlock}>
          <Text style={styles.summaryTitle}>{queue.length} change{queue.length === 1 ? '' : 's'} pending sync</Text>
          <Text style={styles.summarySubtitle}>{isOnline ? 'Ready to retry' : 'Waiting for connection'}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionButton, (!isOnline || isRetrying || queue.length === 0) && styles.actionDisabled]} onPress={retryNow} disabled={!isOnline || isRetrying || queue.length === 0}>
          {isRetrying ? <ActivityIndicator color="#FFFFFF" /> : <><Feather name="refresh-cw" size={18} color="#FFFFFF" /><Text style={styles.actionText}>Retry Now</Text></>}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.clearButton, queue.length === 0 && styles.actionDisabled]} onPress={confirmClear} disabled={queue.length === 0}>
          <Feather name="trash-2" size={18} color="#E74C3C" />
          <Text style={styles.clearText}>Clear Queue</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={queue}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={loadQueue} tintColor="#E94560" colors={['#E94560']} />}
        contentContainerStyle={queue.length ? styles.listContent : styles.emptyContent}
        renderItem={({ item }) => (
          <View style={styles.queueItem}>
            <View style={styles.itemIcon}><Feather name="clock" size={18} color="#0F3460" /></View>
            <View style={styles.itemBody}>
              <Text style={styles.itemTitle}>{item.description}</Text>
              <Text style={styles.itemMeta}>{item.method} {item.url}</Text>
              <Text style={styles.itemTime}>{formatTimestamp(item.timestamp)}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <Feather name="check-circle" size={38} color="#27AE60" />
            <Text style={styles.emptyTitle}>No pending changes</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  summary: { margin: 20, borderRadius: 14, backgroundColor: '#FFFFFF', padding: 16, flexDirection: 'row', alignItems: 'center' },
  summaryIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#0F346014', alignItems: 'center', justifyContent: 'center' },
  summaryTextBlock: { marginLeft: 12, flex: 1 },
  summaryTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900' },
  summarySubtitle: { color: '#6C757D', fontSize: 13, fontWeight: '800', marginTop: 3 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 12 },
  actionButton: { flex: 1, height: 46, borderRadius: 12, backgroundColor: '#0F3460', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  clearButton: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: '#E74C3C', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  actionDisabled: { opacity: 0.5 },
  actionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  clearText: { color: '#E74C3C', fontSize: 14, fontWeight: '900' },
  listContent: { paddingHorizontal: 20, paddingBottom: 28 },
  emptyContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  queueItem: { borderRadius: 12, backgroundColor: '#FFFFFF', padding: 14, flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  itemIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0F346014', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  itemBody: { flex: 1 },
  itemTitle: { color: '#1A1A2E', fontSize: 15, fontWeight: '900' },
  itemMeta: { color: '#6C757D', fontSize: 12, fontWeight: '800', marginTop: 4 },
  itemTime: { color: '#ADB5BD', fontSize: 12, fontWeight: '800', marginTop: 4 },
  emptyState: { alignItems: 'center' },
  emptyTitle: { color: '#1A1A2E', fontSize: 17, fontWeight: '900', marginTop: 10 },
});

