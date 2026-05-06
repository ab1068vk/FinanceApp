import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

export type TrendDatum = {
  label: string;
  value: number;
};

type Props = {
  data: TrendDatum[];
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

export function TrendLineChart({ data, loading = false, height = 190 }: Props) {
  const [selected, setSelected] = useState<TrendDatum | null>(null);
  const width = 320;
  const chartHeight = height - 34;
  const max = useMemo(() => Math.max(1, ...data.map((item) => Math.abs(item.value))), [data]);
  const zeroY = chartHeight / 2;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((item, index) => ({
    ...item,
    x: index * step,
    y: zeroY - (item.value / max) * (chartHeight / 2 - 18),
  }));
  const accessibilityLabel = useMemo(
    () => `Net trend line chart. ${data.map((item) => `${item.label}: ${formatCurrency(item.value)} net`).join('. ')}`,
    [data]
  );

  if (loading) return <LoadingSkeleton height={height} />;
  if (!data.length) {
    return <View style={[styles.empty, { height }]}><Text style={styles.emptyTitle}>No trend data</Text><Text style={styles.emptyText}>Savings trends will appear after transactions are added.</Text></View>;
  }

  return (
    <View>
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        accessible={true}
        accessibilityLabel={accessibilityLabel}
      >
        <Line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke="#DEE2E6" strokeWidth={1} />
        {points.slice(1).map((point, index) => {
          const previous = points[index];
          if (!previous) return null;
          const positive = point.value >= 0 && previous.value >= 0;
          return <Line key={`${point.label}-${index}`} x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} stroke={positive ? '#27AE60' : '#E74C3C'} strokeWidth={3} strokeLinecap="round" />;
        })}
        {points.map((point) => (
          <Circle key={point.label} cx={point.x} cy={point.y} r={6} fill={point.value >= 0 ? '#27AE60' : '#E74C3C'} onPress={() => setSelected(point)} />
        ))}
        {points.map((point) => <SvgText key={`${point.label}-label`} x={point.x} y={height - 8} fontSize="10" fill="#6C757D" textAnchor="middle">{point.label}</SvgText>)}
      </Svg>
      <Text style={styles.tooltip}>{selected ? `${selected.label}: ${formatCurrency(selected.value)} net` : 'Tap points for details'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { borderRadius: 18, backgroundColor: '#E9ECEF', width: '100%' },
  empty: { borderRadius: 18, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyTitle: { color: '#1A1A2E', fontSize: 16, fontWeight: '900' },
  emptyText: { color: '#6C757D', fontSize: 13, marginTop: 6, textAlign: 'center' },
  tooltip: { color: '#6C757D', fontSize: 13, fontWeight: '700', marginTop: 8, textAlign: 'center' },
});
