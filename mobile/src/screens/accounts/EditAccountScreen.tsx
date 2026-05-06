import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import { AccountsStackParamList } from '../../navigation';
import { updateAccount } from '../../store/slices/accountsSlice';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { featherIconName } from '../../utils/icons';
import { parseNonNegativeMoney, sanitizeDecimalInput } from '../../utils/numberInput';

type Props = StackScreenProps<AccountsStackParamList, 'EditAccount'>;

const currencies = ['USD', 'CAD', 'EUR', 'GBP', 'AUD'];
const colors = ['#0F3460', '#E94560', '#27AE60', '#F39C12', '#8B5CF6', '#14B8A6'];
const icons = ['credit-card', 'briefcase', 'dollar-sign', 'trending-up', 'pocket', 'home', 'shield', 'star'];

export default function EditAccountScreen({ navigation, route }: Props) {
  const dispatch = useAppDispatch();
  const account = useAppSelector((state) => state.accounts.accounts.find((item) => item.id === route.params.id));
  const [name, setName] = useState(account?.name || '');
  const [currency, setCurrency] = useState(account?.currency || 'USD');
  const [color, setColor] = useState(account?.color || '#0F3460');
  const [icon, setIcon] = useState(account?.icon || 'credit-card');
  const [overdraftLimit, setOverdraftLimit] = useState(String(account?.overdraft_limit ?? 0));
  const [saving, setSaving] = useState(false);

  const isValid = useMemo(() => name.trim().length > 0 && name.trim().length <= 50, [name]);

  const save = async () => {
    if (!account) {
      showToast({ type: 'error', text1: 'Account unavailable', text2: 'Refresh accounts and try again.' });
      return;
    }
    if (!isValid) {
      showToast({ type: 'error', text1: 'Account name required', text2: 'Enter a name up to 50 characters.' });
      return;
    }

    const parsedOverdraftLimit = parseNonNegativeMoney(overdraftLimit || '0');
    if (parsedOverdraftLimit === null) {
      showToast({ type: 'error', text1: 'Invalid overdraft limit', text2: 'Use a positive number with up to 2 decimals.' });
      return;
    }

    try {
      setSaving(true);
      await dispatch(updateAccount({
        id: account.id,
        data: {
          name: name.trim(),
          currency,
          color,
          icon,
          overdraft_limit: parsedOverdraftLimit,
        },
      })).unwrap();
      showToast({ type: 'success', text1: 'Account updated' });
      navigation.goBack();
    } catch (error) {
      showToast({ type: 'error', text1: 'Unable to update account', text2: typeof error === 'string' ? error : 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (!account) {
    return (
      <View style={styles.centered}>
        <Feather name="credit-card" size={40} color="#ADB5BD" />
        <Text style={styles.emptyTitle}>Account unavailable</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.root}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.preview, { backgroundColor: color }]}>
          <Feather name={featherIconName(icon, 'credit-card')} size={28} color="#FFFFFF" />
          <Text style={styles.previewName} numberOfLines={1}>{name.trim() || account.name}</Text>
          <Text style={styles.previewMeta}>{currency} - {account.type}</Text>
        </View>

        <Text style={styles.label}>Name</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Account name" placeholderTextColor="#ADB5BD" style={styles.input} />

        <Text style={styles.label}>Currency</Text>
        <View style={styles.segmentRow}>
          {currencies.map((item) => (
            <TouchableOpacity key={item} style={[styles.segment, currency === item && styles.segmentActive]} onPress={() => setCurrency(item)}>
              <Text style={[styles.segmentText, currency === item && styles.segmentTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {account && ['checking', 'savings', 'cash'].includes(account.type) ? (
          <>
            <Text style={styles.label}>Overdraft Limit</Text>
            <TextInput value={overdraftLimit} onChangeText={(value) => setOverdraftLimit(sanitizeDecimalInput(value))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#ADB5BD" style={styles.input} />
          </>
        ) : null}

        <Text style={styles.label}>Color</Text>
        <View style={styles.swatchRow}>
          {colors.map((item) => (
            <TouchableOpacity key={item} style={[styles.swatch, { backgroundColor: item }, color === item && styles.swatchActive]} onPress={() => setColor(item)}>
              {color === item ? <Feather name="check" size={18} color="#FFFFFF" /> : null}
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Icon</Text>
        <View style={styles.iconGrid}>
          {icons.map((item) => {
            const active = icon === item;
            return (
              <TouchableOpacity key={item} style={[styles.iconChoice, active && { backgroundColor: color }]} onPress={() => setIcon(item)}>
                <Feather name={featherIconName(item, 'credit-card')} size={22} color={active ? '#FFFFFF' : '#0F3460'} />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={[styles.saveButton, (!isValid || saving) && styles.saveButtonDisabled]} onPress={save} disabled={!isValid || saving}>
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save Changes</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 120 },
  centered: { flex: 1, backgroundColor: '#F8F9FA', alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900', marginTop: 12 },
  preview: { minHeight: 132, borderRadius: 18, padding: 18, justifyContent: 'flex-end', marginBottom: 22 },
  previewName: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', marginTop: 18 },
  previewMeta: { color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: '800', marginTop: 6, textTransform: 'capitalize' },
  label: { color: '#1A1A2E', fontSize: 15, fontWeight: '900', marginTop: 18, marginBottom: 10 },
  input: { height: 50, borderRadius: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 14, color: '#1A1A2E', fontSize: 15 },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: { borderRadius: 999, backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#DEE2E6' },
  segmentActive: { backgroundColor: '#E94560', borderColor: '#E94560' },
  segmentText: { color: '#6C757D', fontSize: 13, fontWeight: '900' },
  segmentTextActive: { color: '#FFFFFF' },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  swatchActive: { borderWidth: 3, borderColor: '#1A1A2E' },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconChoice: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: '#FFFFFF' },
  saveButton: { height: 52, borderRadius: 12, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  saveButtonDisabled: { opacity: 0.55 },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});
