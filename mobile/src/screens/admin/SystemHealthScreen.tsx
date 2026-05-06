import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchSystemHealth, SystemHealth } from '../../store/slices/adminSlice';
import { useTheme } from '../../theme';
import type { FeatherIconName } from '../../utils/icons';

function formatMb(value = 0) {
  return `${value.toFixed(1)} MB`;
}

function memoryStats(health: SystemHealth | null) {
  const legacy = health?.memory_usage;
  const heapUsedMb = Number(health?.heap_used_mb ?? (legacy?.heapUsed ? legacy.heapUsed / 1024 / 1024 : 0));
  const heapLimitMb = Number(health?.heap_limit_mb ?? (legacy?.heapTotal ? legacy.heapTotal / 1024 / 1024 : 0));
  const rssMb = Number(legacy?.rss ? legacy.rss / 1024 / 1024 : 0);
  const externalMb = Number(legacy?.external ? legacy.external / 1024 / 1024 : 0);
  const ratio = heapLimitMb > 0 ? heapUsedMb / heapLimitMb : 0;
  return { heapUsedMb, heapLimitMb, rssMb, externalMb, ratio };
}

function formatUptime(seconds = 0) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} days, ${hours} hours`;
  if (hours > 0) return `${hours} hours, ${minutes} minutes`;
  return `${minutes} minutes`;
}

function healthGrade(health: SystemHealth | null) {
  if (!health) return { grade: 'C', score: 68 };
  const memoryRatio = memoryStats(health).ratio;
  let score = 100;
  if (memoryRatio > 0.85) score -= 25;
  else if (memoryRatio > 0.65) score -= 10;
  if (health.db_size_mb > 512) score -= 10;
  if (health.log_size_mb > 250) score -= 10;
  if (health.active_sessions > 1000) score -= 5;
  if (score >= 90) return { grade: 'A', score };
  if (score >= 75) return { grade: 'B', score };
  return { grade: 'C', score };
}

export default function SystemHealthScreen() {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const { systemHealth, isLoading } = useAppSelector((state) => state.admin);
  const grade = healthGrade(systemHealth);
  const gradeColor = grade.grade === 'A' ? theme.colors.success : grade.grade === 'B' ? theme.colors.warning : theme.colors.danger;
  const memory = memoryStats(systemHealth);
  const memoryRatio = memory.ratio;

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    content: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl },
    scoreCard: { backgroundColor: theme.colors.primary, borderRadius: theme.borderRadius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.md, ...theme.shadows.large },
    scoreTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    scoreLabel: { color: theme.colors.text.inverse, fontSize: theme.typography.lg, fontWeight: '800' },
    refreshButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
    gradeWrap: { alignItems: 'center', marginTop: theme.spacing.lg },
    grade: { color: gradeColor, fontSize: 76, fontWeight: '900' },
    scoreText: { color: theme.colors.text.inverse, fontSize: theme.typography.md, fontWeight: '700' },
    healthText: { color: theme.colors.text.light, fontSize: theme.typography.sm, marginTop: theme.spacing.xs },
    metricCard: { backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm, ...theme.shadows.small },
    metricTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
    metricLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flex: 1 },
    iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background },
    metricLabel: { color: theme.colors.text.secondary, fontSize: theme.typography.sm, marginBottom: 2 },
    metricValue: { color: theme.colors.text.primary, fontSize: theme.typography.lg, fontWeight: '800' },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: theme.colors.border, overflow: 'hidden', marginTop: theme.spacing.md },
    progressFill: { height: '100%', borderRadius: 4 },
    empty: { alignItems: 'center', padding: theme.spacing.xl, gap: theme.spacing.sm },
  }), [gradeColor, theme]);

  useEffect(() => {
    dispatch(fetchSystemHealth());
  }, [dispatch]);

  const metrics: Array<{ icon: FeatherIconName; color: string; label: string; value: string }> = [
    { icon: 'clock', color: theme.colors.accent, label: 'Server Uptime', value: formatUptime(systemHealth?.uptime_seconds || 0) },
    { icon: 'hard-drive', color: theme.colors.highlight, label: 'Database Size', value: `${(systemHealth?.db_size_mb || 0).toFixed(2)} MB` },
    { icon: 'users', color: theme.colors.success, label: 'Active Sessions', value: String(systemHealth?.active_sessions || 0) },
    { icon: 'file-text', color: theme.colors.warning, label: 'Total Log Files Size', value: `${systemHealth?.log_count || 0} files / ${(systemHealth?.log_size_mb || 0).toFixed(2)} MB` },
    { icon: 'code', color: theme.colors.secondary, label: 'Node.js Version', value: systemHealth?.node_version || 'Unknown' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.scoreCard}>
        <View style={styles.scoreTop}>
          <Text style={styles.scoreLabel}>System Health</Text>
          <Pressable style={styles.refreshButton} onPress={() => dispatch(fetchSystemHealth())} disabled={isLoading}>
            {isLoading ? <ActivityIndicator color={theme.colors.text.inverse} /> : <Feather name="refresh-cw" size={20} color={theme.colors.text.inverse} />}
          </Pressable>
        </View>
        <View style={styles.gradeWrap}>
          <Text style={styles.grade}>{grade.grade}</Text>
          <Text style={styles.scoreText}>{Math.round(grade.score)} / 100</Text>
          <Text style={styles.healthText}>{grade.grade === 'A' ? 'Healthy' : grade.grade === 'B' ? 'Needs attention' : 'Critical attention recommended'}</Text>
        </View>
      </View>

      <View style={styles.metricCard}>
        <View style={styles.metricTop}>
          <View style={styles.metricLeft}>
            <View style={styles.iconCircle}><Feather name="cpu" size={20} color={theme.colors.danger} /></View>
            <View>
              <Text style={styles.metricLabel}>Memory Usage</Text>
              <Text style={styles.metricValue}>{formatMb(memory.heapUsedMb)} / {formatMb(memory.heapLimitMb)}</Text>
            </View>
          </View>
          <Text style={[styles.metricValue, { color: memoryRatio > 0.85 ? theme.colors.danger : memoryRatio > 0.65 ? theme.colors.warning : theme.colors.success }]}>{Math.round(memoryRatio * 100)}%</Text>
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(memoryRatio * 100, 100)}%`, backgroundColor: memoryRatio > 0.85 ? theme.colors.danger : memoryRatio > 0.65 ? theme.colors.warning : theme.colors.success }]} /></View>
        <Text style={[styles.metricLabel, { marginTop: theme.spacing.sm }]}>RSS: {formatMb(memory.rssMb)} | External: {formatMb(memory.externalMb)}</Text>
      </View>

      {metrics.map((metric) => (
        <View key={metric.label} style={styles.metricCard}>
          <View style={styles.metricTop}>
            <View style={styles.metricLeft}>
              <View style={styles.iconCircle}><Feather name={metric.icon} size={20} color={metric.color} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.metricLabel}>{metric.label}</Text>
                <Text style={styles.metricValue}>{metric.value}</Text>
              </View>
            </View>
          </View>
        </View>
      ))}

      {!systemHealth && !isLoading ? (
        <View style={styles.empty}>
          <Feather name="alert-circle" size={40} color={theme.colors.text.light} />
          <Text style={styles.metricLabel}>System health data is unavailable.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
