import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { getApiErrorMessage } from '../services/apiErrors';
import { AppDispatch } from '../store';
import { fetchAccounts } from '../store/slices/accountsSlice';
import { fetchBudgets } from '../store/slices/budgetsSlice';
import { fetchTransactions, transactionsActions } from '../store/slices/transactionsSlice';
import { useAppDispatch } from '../store/hooks';
import { showToast } from '../components/common/Toast';
import { dequeue, getQueue, QueuedMutation } from '../utils/offlineQueue';

function isOnlineState(state: { isConnected: boolean | null; isInternetReachable: boolean | null }) {
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

async function replayMutation(mutation: QueuedMutation) {
  return api.request({
    method: mutation.method,
    url: mutation.url,
    data: mutation.data,
  });
}

function isServerRejection(error: unknown) {
  return axios.isAxiosError(error) && Boolean(error.response);
}

function describeTransactionFailure(mutation: QueuedMutation, reason: string) {
  const date = mutation.optimisticTransactionDate
    ? new Date(mutation.optimisticTransactionDate).toLocaleDateString()
    : 'offline';
  return `Transaction from ${date} could not be synced: ${reason}`;
}

async function refreshFinancialState(dispatch: AppDispatch) {
  await Promise.allSettled([
    dispatch(fetchAccounts()).unwrap(),
    dispatch(fetchTransactions({ page: 1, limit: 20 })).unwrap(),
    dispatch(fetchBudgets()).unwrap(),
  ]);
}

export async function processOfflineQueue(dispatch: AppDispatch) {
  const queue = await getQueue();
  let attemptedMutation = false;

  for (const mutation of queue) {
    try {
      await replayMutation(mutation);
      attemptedMutation = true;
      await dequeue(mutation.id);
    } catch (error) {
      if (!isServerRejection(error)) {
        if (attemptedMutation) await refreshFinancialState(dispatch);
        throw error;
      }

      attemptedMutation = true;
      await dequeue(mutation.id);
      if (mutation.optimisticTransactionId) {
        dispatch(transactionsActions.removeTransaction(mutation.optimisticTransactionId));
      }
      showToast({
        type: 'error',
        text1: 'Offline sync failed',
        text2: describeTransactionFailure(mutation, getApiErrorMessage(error, 'Server rejected the request')),
      });
    }
  }

  if (attemptedMutation || queue.length > 0) await refreshFinancialState(dispatch);
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
