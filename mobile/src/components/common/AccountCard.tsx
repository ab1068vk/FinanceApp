import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Account } from '../../store/slices/accountsSlice';
import { useTheme } from '../../theme';
import { formatCurrency } from '../../utils/formatters';
import { featherIconName, type FeatherIconName } from '../../utils/icons';

type Props = {
  account?: Account;
  selected?: boolean;
  addCard?: boolean;
  wide?: boolean;
  onPress?: () => void;
};

const iconByType: Record<string, FeatherIconName> = {
  checking: 'briefcase',
  savings: 'dollar-sign',
  credit: 'credit-card',
  investment: 'trending-up',
  cash: 'pocket',
};

export function AccountCard({ account, selected = false, addCard = false, wide = false, onPress }: Props) {
  const theme = useTheme();

  if (addCard) {
    return (
      <TouchableOpacity style={[styles.card, wide && styles.wideCard, styles.addCard]} onPress={onPress} activeOpacity={0.82}>
        <View style={styles.addIconCircle}>
          <Feather name="plus" size={24} color={theme.colors.text.secondary} />
        </View>
        <Text style={styles.addText}>Add Account</Text>
      </TouchableOpacity>
    );
  }

  if (!account) return null;

  const accent = account.color || theme.colors.accent;
  const balance = account.current_balance ?? account.balance ?? 0;
  const isNegative = Number(balance) < 0;

  return (
    <TouchableOpacity
      style={[styles.card, wide && styles.wideCard, theme.shadows.medium, selected && { borderBottomColor: theme.colors.highlight, borderBottomWidth: 4 }]}
      onPress={onPress}
      activeOpacity={0.86}
    >
      <View style={[styles.iconCircle, { backgroundColor: `${accent}22` }]}> 
        <Feather name={featherIconName(account.icon || iconByType[account.type], 'credit-card')} size={21} color={accent} />
      </View>
      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>{account.name}</Text>
        <Text style={[styles.balance, isNegative && styles.negativeBalance]} numberOfLines={1}>{formatCurrency(balance, account.currency)}</Text>
        <View style={styles.typeRow}>
          {isNegative ? <Feather name="alert-triangle" size={12} color="#E74C3C" /> : null}
          <Text style={[styles.type, isNegative && styles.negativeType]}>{account.type}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 180,
    height: 100,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    marginRight: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000000',
  },
  wideCard: { width: '100%', marginRight: 0, marginBottom: 12 },
  addCard: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#ADB5BD',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
  },
  addIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  addText: { color: '#6C757D', fontSize: 14, fontWeight: '700' },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  content: { flex: 1, minWidth: 0 },
  name: { color: '#1A1A2E', fontSize: 14, fontWeight: '800' },
  balance: { color: '#1A1A2E', fontSize: 18, fontWeight: '900', marginTop: 8 },
  negativeBalance: { color: '#E74C3C' },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  type: { color: '#6C757D', fontSize: 12, textTransform: 'capitalize' },
  negativeType: { color: '#E74C3C', fontWeight: '800' },
});
