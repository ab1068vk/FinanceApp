import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';

export type BarDatum = {
  label: string;
  income: number;
  expense: number;
};

type Props = {
  data: BarDatum[];
  loading?: boolean;
  height?: number;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
}

function LoadingSkeleton({ height }: { height: number }) {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.85, duration: 650, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.35, duration: 650, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <Animated.View style={[styles.skeleton, { height, opacity }]} />;
}

export function IncomeExpenseBarChart({ data, loading = false, height = 220 }: Props) {
  const [selected, setSelected] = useState<BarDatum | null>(null);
  const chartWidth = 320;
  const chartHeight = height - 38;
  const max = useMemo(() => Math.max(1, ...data.flatMap((item) => [item.income, item.expense])), [data]);
  const groupWidth = data.length ? chartWidth / data.length : chartWidth;
  const accessibilityLabel = useMemo(
    () => `Income and expense bar chart. ${data.map((item) => `${item.label}: ${formatCurrency(item.income)} income, ${formatCurrency(item.expense)} expenses`).join('. ')}`,
    [data]
  );

  if (loading) return <LoadingSkeleton height={height} />;
  if (!data.length) {
    return <View style={[styles.empty, { height }]}><Text style={styles.emptyTitle}>No income or expense data</Text><Text style={styles.emptyText}>Activity for this period will appear here.</Text></View>;
  }

  return (
    <View>
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${chartWidth} ${height}`}
        accessible={true}
        accessibilityLabel={accessibilityLabel}
      >
        {data.map((item, index) => {
          const incomeHeight = (item.income / max) * (chartHeight - 26);
          const expenseHeight = (item.expense / max) * (chartHeight - 26);
          const x = index * groupWidth + groupWidth / 2 - 15;
          return (
            <G key={`${item.label}-${index}`} onPress={() => setSelected(item)}>
              <Rect x={x} y={chartHeight - incomeHeight} width={12} height={incomeHeight} rx={6} fill="#27AE60" />
              <Rect x={x + 18} y={chartHeight - expenseHeight} width={12} height={expenseHeight} rx={6} fill="#E74C3C" />
              <SvgText x={x + 15} y={height - 8} fontSize="10" fill="#6C757D" textAnchor="middle">{item.label}</SvgText>
            </G>
          );
        })}
      </Svg>
      <View style={styles.legendRow}>
        <Legend color="#27AE60" label="Income" />
        <Legend color="#E74C3C" label="Expense" />
      </View>
      <Text style={styles.tooltip}>{selected ? `${selected.label}: ${formatCurrency(selected.income)} income, ${formatCurrency(selected.expense)} expenses` : 'Tap bars for details'}</Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <View style={styles.legend}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  skeleton: { borderRadius: 18, backgroundColor: '#E9ECEF', width: '100%' },
  empty: { borderRadius: 18, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyTitle: { color: '#1A1A2E', fontSize: 16, fontWeight: '900' },
  emptyText: { color: '#6C757D', fontSize: 13, marginTop: 6, textAlign: 'center' },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 4 },
  legend: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 6 },
  legendText: { color: '#6C757D', fontSize: 12, fontWeight: '800' },
  tooltip: { color: '#6C757D', fontSize: 13, fontWeight: '700', marginTop: 8, textAlign: 'center' },
});
