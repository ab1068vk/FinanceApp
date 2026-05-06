import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { format } from 'date-fns';
import { Transaction } from '../../store';
import { useTheme } from '../../theme';

type Props = {
  transaction: Transaction;
  onPress?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  selectionMode?: boolean;
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount || 0);
}

function safeDate(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? '' : format(parsed, 'MMM d');
}

export function TransactionListItem({ transaction, onPress, onLongPress, selected = false, selectionMode = false }: Props) {
  const theme = useTheme();
  const isIncome = transaction.type === 'income';
  const color = isIncome ? theme.colors.success : theme.colors.danger;
  const categoryName = String(transaction.category_name || transaction.type || 'Transaction');
  const description = transaction.description || categoryName;

  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.selectedCard, theme.shadows.small]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={onPress ? 0.82 : 1}
    >
      {selectionMode ? (
        <Feather name={selected ? 'check-square' : 'square'} size={22} color={selected ? theme.colors.accent : '#ADB5BD'} style={styles.checkbox} />
      ) : null}
      <View style={[styles.iconCircle, { backgroundColor: `${color}18` }]}> 
        <Feather name={isIncome ? 'arrow-up-right' : 'arrow-down-left'} size={20} color={color} />
      </View>
      <View style={styles.center}>
        <Text style={styles.description} numberOfLines={1}>{description}</Text>
        <Text style={styles.category} numberOfLines={1}>{categoryName}</Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, { color }]}>{isIncome ? '+' : '-'}{formatCurrency(transaction.amount)}</Text>
        <Text style={styles.date}>{safeDate(transaction.date)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 72,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginBottom: 12,
    shadowColor: '#000000',
  },
  selectedCard: { borderWidth: 1, borderColor: '#E94560' },
  checkbox: { marginRight: 10 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, marginHorizontal: 12, minWidth: 0 },
  description: { color: '#1A1A2E', fontSize: 15, fontWeight: '800' },
  category: { color: '#6C757D', fontSize: 13, marginTop: 5 },
  right: { alignItems: 'flex-end' },
  amount: { fontSize: 16, fontWeight: '900' },
  date: { color: '#6C757D', fontSize: 12, marginTop: 5 },
});

