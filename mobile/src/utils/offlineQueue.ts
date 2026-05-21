import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

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

const LEGACY_STORAGE_KEY = 'offlineQueue';
const INDEX_KEY = 'offlineQueue:index';
const ITEM_CHUNK_COUNT_PREFIX = 'offlineQueue:itemChunks:';
const ITEM_CHUNK_PREFIX = 'offlineQueue:itemChunk:';
const SECURE_STORE_CHUNK_SIZE = 1000;
const ALLOWED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function createId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const digit = char === 'x' ? value : (value & 0x3) | 0x8;
    return digit.toString(16);
  });
}

function isQueuedMutation(item: unknown): item is QueuedMutation {
  return Boolean(
    item
    && typeof item === 'object'
    && 'id' in item
    && 'timestamp' in item
    && 'method' in item
    && 'url' in item
    && 'description' in item
    && typeof item.id === 'string'
    && typeof item.timestamp === 'number'
    && typeof item.method === 'string'
    && ALLOWED_METHODS.has(item.method)
    && typeof item.url === 'string'
    && typeof item.description === 'string',
  );
}

function itemChunkCountKey(id: string) {
  return `${ITEM_CHUNK_COUNT_PREFIX}${id}`;
}

function itemChunkKey(id: string, index: number) {
  return `${ITEM_CHUNK_PREFIX}${id}:${index}`;
}

async function readIndex() {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

async function saveIndex(ids: string[]) {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(Array.from(new Set(ids))));
}

async function deleteSecureItem(id: string) {
  const countRaw = await SecureStore.getItemAsync(itemChunkCountKey(id));
  const count = Number(countRaw || 0);
  if (Number.isInteger(count) && count > 0) {
    await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(itemChunkKey(id, index))),
    );
  }
  await SecureStore.deleteItemAsync(itemChunkCountKey(id));
}

async function saveSecureItem(item: QueuedMutation) {
  const serialized = JSON.stringify(item);
  const chunks = serialized.match(new RegExp(`.{1,${SECURE_STORE_CHUNK_SIZE}}`, 'g')) || [''];
  await deleteSecureItem(item.id);
  await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(itemChunkKey(item.id, index), chunk)));
  await SecureStore.setItemAsync(itemChunkCountKey(item.id), String(chunks.length));
}

async function readSecureItem(id: string) {
  const countRaw = await SecureStore.getItemAsync(itemChunkCountKey(id));
  const count = Number(countRaw || 0);
  if (!Number.isInteger(count) || count <= 0) return null;

  const chunks = await Promise.all(
    Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(itemChunkKey(id, index))),
  );
  if (chunks.some((chunk) => chunk === null)) return null;

  try {
    const parsed = JSON.parse(chunks.join(''));
    return isQueuedMutation(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readSecureQueue() {
  const ids = await readIndex();
  const queue: QueuedMutation[] = [];
  const validIds: string[] = [];

  for (const id of ids) {
    const item = await readSecureItem(id);
    if (item) {
      queue.push(item);
      validIds.push(id);
    } else {
      await deleteSecureItem(id);
    }
  }

  if (validIds.length !== ids.length) await saveIndex(validIds);
  return queue.sort((left, right) => left.timestamp - right.timestamp);
}

async function saveQueue(queue: QueuedMutation[]) {
  const sortedQueue = [...queue].sort((left, right) => left.timestamp - right.timestamp);
  const nextIds = sortedQueue.map((item) => item.id);
  const previousIds = await readIndex();
  const nextIdSet = new Set(nextIds);

  await Promise.all(previousIds.filter((id) => !nextIdSet.has(id)).map((id) => deleteSecureItem(id)));
  await Promise.all(sortedQueue.map((item) => saveSecureItem(item)));
  await saveIndex(nextIds);
}

async function migrateLegacyQueue() {
  const raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return;

  let legacyQueue: QueuedMutation[];
  try {
    const parsed = JSON.parse(raw);
    legacyQueue = Array.isArray(parsed) ? parsed.filter(isQueuedMutation) : [];
  } catch {
    // Plaintext legacy data is discarded if it cannot be parsed safely.
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    return;
  }

  if (legacyQueue.length > 0) {
    const secureQueue = await readSecureQueue();
    const merged = new Map<string, QueuedMutation>();
    for (const item of secureQueue) merged.set(item.id, item);
    for (const item of legacyQueue) {
      if (!merged.has(item.id)) merged.set(item.id, item);
    }
    await saveQueue(Array.from(merged.values()));
  }

  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
}

export async function getQueue(): Promise<QueuedMutation[]> {
  await migrateLegacyQueue();
  return readSecureQueue();
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
  const ids = await readIndex();
  await Promise.all(ids.map((id) => deleteSecureItem(id)));
  await Promise.all([
    SecureStore.deleteItemAsync(INDEX_KEY),
    AsyncStorage.removeItem(LEGACY_STORAGE_KEY),
  ]);
}
