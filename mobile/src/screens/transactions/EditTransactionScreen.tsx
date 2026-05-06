import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import { DatePickerField } from '../../components/common/DatePickerField';
import api from '../../services/api';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchAccounts } from '../../store/slices/accountsSlice';
import { fetchTransactionById, updateTransaction } from '../../store/slices/transactionsSlice';
import { TransactionsStackParamList } from '../../navigation';
import { featherIconName } from '../../utils/icons';
import { ListPayload, unwrapList } from '../../types/api';
import { parsePositiveMoney, sanitizeDecimalInput } from '../../utils/numberInput';

type Props = StackScreenProps<TransactionsStackParamList, 'EditTransaction'>;
type Category = { id: string; name: string; icon?: string; color?: string; type?: 'income' | 'expense' };
const MAX_TRANSACTION_AMOUNT = 100000000;

function parseTags(tags: unknown): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(String);
  try {
    const parsed = JSON.parse(String(tags));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function isValidDate(dateString: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateString;
}

export default function EditTransactionScreen({ navigation, route }: Props) {
  const dispatch = useAppDispatch();
  const transaction = useAppSelector((state) => state.transactions.selectedTransaction?.id === route.params.id ? state.transactions.selectedTransaction : null);
  const loading = useAppSelector((state) => state.transactions.isLoading);
  const [categories, setCategories] = useState<Category[]>([]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    dispatch(fetchTransactionById(route.params.id));
    api.get<ListPayload<Category>>('/api/categories', { params: { page: 1, limit: 200 } }).then((response) => setCategories(unwrapList(response.data))).catch(() => setCategories([]));
  }, [dispatch, route.params.id]);

  useEffect(() => {
    if (!transaction) return;
    setAmount(String(Number(transaction.amount || 0)));
    setDescription(String(transaction.description || ''));
    setCategoryId(String(transaction.category_id || ''));
    setDate(new Date(transaction.date).toISOString().slice(0, 10));
    setNote(String(transaction.note || ''));
    setTags(parseTags(transaction.tags));
  }, [transaction]);

  const availableCategories = useMemo(() => {
    if (!transaction || transaction.type === 'transfer') return categories;
    return categories.filter((category) => !category.type || category.type === transaction.type);
  }, [categories, transaction]);

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) setTags((current) => [...current, trimmed]);
    setTagInput('');
  };

  const save = async () => {
    if (!transaction) return;
    const amountNumber = parsePositiveMoney(amount);
    if (amountNumber === null) {
      showToast({ type: 'error', text1: 'Amount required', text2: 'Enter an amount greater than zero.' });
      return;
    }
    if (amountNumber > MAX_TRANSACTION_AMOUNT) {
      showToast({ type: 'error', text1: 'Amount too large', text2: 'Transactions cannot exceed $100,000,000.' });
      return;
    }
    if (!isValidDate(date)) {
      showToast({ type: 'error', text1: 'Invalid date', text2: 'Use YYYY-MM-DD.' });
      return;
    }

    try {
      await dispatch(updateTransaction({
        id: transaction.id,
        data: {
          amount: amountNumber,
          description: description.trim() || undefined,
          note: note.trim() || undefined,
          category_id: categoryId || undefined,
          date: new Date(`${date}T00:00:00.000Z`).toISOString(),
          tags,
        },
      })).unwrap();
      dispatch(fetchAccounts());
      showToast({ type: 'success', text1: 'Transaction updated' });
      navigation.goBack();
    } catch (error) {
      showToast({ type: 'error', text1: 'Update failed', text2: typeof error === 'string' ? error : 'Please try again.' });
    }
  };

  if (loading && !transaction) {
    return <View style={styles.centered}><ActivityIndicator color="#E94560" /></View>;
  }

  if (!transaction) {
    return <View style={styles.centered}><Text style={styles.missingText}>Transaction unavailable</Text></View>;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.label}>Amount</Text>
        <TextInput
          value={amount}
          onChangeText={(value) => setAmount(sanitizeDecimalInput(value))}
          placeholder="0.00"
          keyboardType="decimal-pad"
          style={styles.input}
        />

        <Text style={styles.label}>Description</Text>
        <TextInput value={description} onChangeText={setDescription} placeholder="Description" style={styles.input} />

        <Text style={styles.label}>Category</Text>
        <View style={styles.categoryGrid}>
          {availableCategories.map((category) => {
            const selected = category.id === categoryId;
            return (
              <TouchableOpacity key={category.id} style={[styles.categoryItem, selected && styles.categoryItemActive]} onPress={() => setCategoryId(category.id)}>
                <Feather name={featherIconName(category.icon, 'tag')} size={18} color={selected ? '#FFFFFF' : category.color || '#0F3460'} />
                <Text style={[styles.categoryText, selected && styles.categoryTextActive]} numberOfLines={1}>{category.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>Date</Text>
        <DatePickerField value={date} onChange={setDate} placeholder="Transaction date" style={styles.input} />

        <Text style={styles.label}>Note</Text>
        <TextInput value={note} onChangeText={setNote} placeholder="Note" multiline style={styles.noteInput} />

        <Text style={styles.label}>Tags</Text>
        <View style={styles.tagInputRow}>
          <TextInput value={tagInput} onChangeText={setTagInput} onSubmitEditing={addTag} placeholder="Add tag" style={styles.tagInput} />
          <TouchableOpacity style={styles.tagAddButton} onPress={addTag}><Feather name="plus" size={20} color="#FFFFFF" /></TouchableOpacity>
        </View>
        <View style={styles.tagsRow}>
          {tags.map((tag) => (
            <TouchableOpacity key={tag} style={styles.tag} onPress={() => setTags((current) => current.filter((item) => item !== tag))}>
              <Text style={styles.tagText}>{tag}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.saveButton} onPress={save} disabled={loading}>
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save Changes</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FA' },
  missingText: { color: '#6C757D', fontWeight: '800' },
  content: { padding: 20, paddingBottom: 110 },
  label: { color: '#1A1A2E', fontSize: 15, fontWeight: '900', marginTop: 18, marginBottom: 10 },
  input: { minHeight: 50, borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 14, color: '#1A1A2E', fontSize: 15 },
  noteInput: { minHeight: 96, borderRadius: 14, backgroundColor: '#FFFFFF', padding: 14, color: '#1A1A2E', textAlignVertical: 'top' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryItem: { width: '30.8%', minHeight: 74, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: 8 },
  categoryItemActive: { backgroundColor: '#E94560' },
  categoryText: { color: '#1A1A2E', fontSize: 12, fontWeight: '800', marginTop: 6 },
  categoryTextActive: { color: '#FFFFFF' },
  tagInputRow: { flexDirection: 'row' },
  tagInput: { flex: 1, height: 46, borderRadius: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 12 },
  tagAddButton: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  tag: { borderRadius: 999, backgroundColor: '#E9456018', paddingHorizontal: 12, paddingVertical: 7 },
  tagText: { color: '#E94560', fontWeight: '800' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: '#FFFFFF' },
  saveButton: { height: 52, borderRadius: 12, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});
