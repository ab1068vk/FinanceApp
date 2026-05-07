import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { AppDispatch } from '../store';
import { fetchAccounts } from '../store/slices/accountsSlice';
import { fetchBudgets } from '../store/slices/budgetsSlice';
import { fetchTransactions } from '../store/slices/transactionsSlice';
import { useAppDispatch } from '../store/hooks';
import { dequeue, getQueue, QueuedMutation } from '../utils/offlineQueue';

function isOnlineState(state: { isConnected: boolean | null; isInternetReachable: boolean | null }) {
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

async function replayMutation(mutation: QueuedMutation) {
  await api.request({
    method: mutation.method,
    url: mutation.url,
    data: mutation.data,
  });
}

export async function processOfflineQueue(dispatch: AppDispatch) {
  const queue = await getQueue();
  for (const mutation of queue) {
    await replayMutation(mutation);
    await dequeue(mutation.id);
  }

  await Promise.all([
    dispatch(fetchAccounts()).unwrap(),
    dispatch(fetchTransactions({ page: 1, limit: 20 })).unwrap(),
    dispatch(fetchBudgets()).unwrap(),
  ]);
}

export function useOfflineQueue() {
  const dispatch = useAppDispatch();
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const wasOnline = useRef<boolean | null>(null);

  const retryNow = useCallback(async () => {
    if (isProcessingQueue) return;
    setIsProcessingQueue(true);
    try {
      await processOfflineQueue(dispatch);
    } finally {
      setIsProcessingQueue(false);
    }
  }, [dispatch, isProcessingQueue]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = isOnlineState(state);
      const reconnected = wasOnline.current === false && online;
      wasOnline.current = online;
      if (reconnected) void retryNow();
    });

    void NetInfo.fetch().then((state) => {
      wasOnline.current = isOnlineState(state);
    });

    return unsubscribe;
  }, [retryNow]);

  return { isProcessingQueue, retryNow };
}

