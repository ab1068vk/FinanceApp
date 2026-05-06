import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Budget } from '../../store';
import { useTheme } from '../../theme';

type Props = {
  budget: Budget;
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
}

export function BudgetProgressCard({ budget }: Props) {
  const theme = useTheme();
  const spent = Number(budget.current_spending || 0);
  const amount = Number(budget.amount || 0);
  const ratio = amount > 0 ? spent / amount : 0;
  const progress = Math.min(ratio, 1);
  const isOver = ratio > 1;
  const overage = Math.max(spent - amount, 0);
  const color = isOver ? theme.colors.danger : ratio > 0.82 ? theme.colors.warning : theme.colors.success;
  const categoryName = String(budget.category_name || 'Budget');

  return (
    <View style={[styles.card, theme.shadows.small]}>
      <View style={styles.topRow}>
        <View style={styles.leftRow}>
          <View style={[styles.iconCircle, { backgroundColor: `${color}18` }]}> 
            <Feather name={isOver ? 'alert-triangle' : 'pie-chart'} size={18} color={color} />
          </View>
          <Text style={styles.name} numberOfLines={1}>{categoryName}</Text>
        </View>
        <Text style={styles.amount}>{formatCurrency(spent)} of {formatCurrency(amount)}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.progress, { width: `${progress * 100}%`, backgroundColor: color }]} />
      </View>
      {isOver ? (
        <Text style={styles.overText}>Over by {formatCurrency(overage)}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000000',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  leftRow: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  name: { color: '#1A1A2E', fontSize: 15, fontWeight: '800', flex: 1 },
  amount: { color: '#6C757D', fontSize: 13, fontWeight: '700', marginLeft: 10 },
  track: { height: 8, borderRadius: 999, backgroundColor: '#EEF0F2', overflow: 'hidden' },
  progress: { height: 8, borderRadius: 999 },
  overText: { color: '#E74C3C', fontSize: 12, fontWeight: '900', marginTop: 8, textAlign: 'right' },
});
