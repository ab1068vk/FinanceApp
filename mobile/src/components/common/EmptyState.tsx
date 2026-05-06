import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useTheme } from '../../theme';
import { featherIconName } from '../../utils/icons';

type Props = {
  icon: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function EmptyState({ icon, title, subtitle, actionLabel, onAction }: Props) {
  const theme = useTheme();
  const isEmoji = Array.from(icon).length <= 2 && !/^[a-z-]+$/.test(icon);

  return (
    <View style={styles.container}>
      <View style={[styles.graphic, { backgroundColor: theme.colors.surface }]}> 
        {isEmoji ? <Text style={styles.emoji}>{icon}</Text> : <Feather name={featherIconName(icon)} size={42} color={theme.colors.accent} />}
      </View>
      <Text style={[styles.title, { color: theme.colors.text.primary }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: theme.colors.text.secondary }]}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable style={[styles.button, { backgroundColor: theme.colors.highlight }]} onPress={onAction}>
          <Text style={[styles.buttonText, { color: theme.colors.text.inverse }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  graphic: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emoji: { fontSize: 42 },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 8 },
  button: { height: 48, borderRadius: 12, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  buttonText: { fontSize: 15, fontWeight: '800' },
});
