import AsyncStorage from '@react-native-async-storage/async-storage';

export interface QueuedMutation {
  id: string;
  timestamp: number;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  data?: unknown;
  description: string;
  optimisticTransactionId?: string;
  optimisticTransactionDate?: string;
}

const STORAGE_KEY = 'offlineQueue';

function createId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const digit = char === 'x' ? value : (value & 0x3) | 0x8;
    return digit.toString(16);
  });
}

async function saveQueue(queue: QueuedMutation[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export async function getQueue(): Promise<QueuedMutation[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is QueuedMutation => Boolean(item?.id && item?.timestamp && item?.method && item?.url && item?.description))
      .sort((left, right) => left.timestamp - right.timestamp);
  } catch {
    return [];
  }
}

export async function enqueue(mutation: Omit<QueuedMutation, 'id' | 'timestamp'> & Partial<Pick<QueuedMutation, 'id' | 'timestamp'>>) {
  const queue = await getQueue();
  const queued: QueuedMutation = {
    id: mutation.id || createId(),
    timestamp: mutation.timestamp || Date.now(),
    method: mutation.method,
    url: mutation.url,
    data: mutation.data,
    description: mutation.description,
    optimisticTransactionId: mutation.optimisticTransactionId,
    optimisticTransactionDate: mutation.optimisticTransactionDate,
  };
  await saveQueue([...queue, queued]);
  return queued;
}

export async function dequeue(id: string) {
  const queue = await getQueue();
  await saveQueue(queue.filter((item) => item.id !== id));
}

export async function clearQueue() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
