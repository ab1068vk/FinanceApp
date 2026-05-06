import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

export type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

type Props = {
  data: DonutSegment[];
  loading?: boolean;
  size?: number;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
}

function LoadingSkeleton({ height = 220 }: { height?: number }) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <Animated.View style={[styles.skeleton, { height, opacity }]} />;
}

export function SpendingDonutChart({ data, loading = false, size = 210 }: Props) {
  const [selected, setSelected] = useState<DonutSegment | null>(null);
  const total = useMemo(() => data.reduce((sum, item) => sum + Math.max(item.value, 0), 0), [data]);
  const radius = size / 2 - 18;
  const circumference = 2 * Math.PI * radius;
  const accessibilityLabel = useMemo(
    () => `Spending donut chart. ${data.map((segment) => `${segment.label}: ${formatCurrency(segment.value)}`).join('. ')}`,
    [data]
  );
  let offset = 0;

  useEffect(() => {
    setSelected(data[0] || null);
  }, [data]);

  if (loading) return <LoadingSkeleton height={size + 16} />;

  if (!data.length || total <= 0) {
    return (
      <View style={[styles.empty, { height: size + 16 }]}> 
        <Text style={styles.emptyTitle}>No spending data</Text>
        <Text style={styles.emptyText}>Transactions for this period will appear here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} accessible={true} accessibilityLabel={accessibilityLabel}>
          <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
            <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#EEF0F2" strokeWidth={18} fill="none" />
            {data.map((segment) => {
              const length = (Math.max(segment.value, 0) / total) * circumference;
              const dashOffset = -offset;
              offset += length;
              return (
                <Circle
                  key={segment.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke={segment.color}
                  strokeWidth={18}
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  fill="none"
                  onPress={() => setSelected(segment)}
                />
              );
            })}
          </G>
        </Svg>
        <View style={styles.centerLabel}>
          <Text style={styles.centerAmount}>{formatCurrency(selected?.value || total)}</Text>
          <Text style={styles.centerText}>{selected ? selected.label : 'Total'}</Text>
        </View>
      </View>
      <Text style={styles.tooltip}>{selected ? `${selected.label}: ${formatCurrency(selected.value)} (${Math.round((selected.value / total) * 100)}%)` : 'Tap a segment for details'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center' },
  skeleton: { borderRadius: 18, backgroundColor: '#E9ECEF', width: '100%' },
  empty: { borderRadius: 18, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyTitle: { color: '#1A1A2E', fontSize: 16, fontWeight: '900' },
  emptyText: { color: '#6C757D', fontSize: 13, marginTop: 6, textAlign: 'center' },
  centerLabel: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  centerAmount: { color: '#1A1A2E', fontSize: 20, fontWeight: '900' },
  centerText: { color: '#6C757D', fontSize: 12, fontWeight: '800', marginTop: 4 },
  tooltip: { color: '#6C757D', fontSize: 13, fontWeight: '700', marginTop: 8, textAlign: 'center' },
});
