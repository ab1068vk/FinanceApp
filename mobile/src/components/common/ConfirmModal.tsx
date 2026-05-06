import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Modal from 'react-native-modal';
import { useTheme } from '../../theme';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
};

export default function ConfirmModal({ visible, title, message, confirmLabel, onConfirm, onCancel, destructive = false }: Props) {
  const theme = useTheme();

  return (
    <Modal isVisible={visible} onBackdropPress={onCancel} style={styles.modal}>
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}> 
        <Text style={[styles.title, { color: theme.colors.text.primary }]}>{title}</Text>
        <Text style={[styles.message, { color: theme.colors.text.secondary }]}>{message}</Text>
        <View style={styles.actions}>
          <Pressable style={[styles.cancel, { borderColor: theme.colors.border }]} onPress={onCancel}>
            <Text style={[styles.cancelText, { color: theme.colors.text.primary }]}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.confirm, { backgroundColor: destructive ? theme.colors.danger : theme.colors.highlight }]} onPress={onConfirm}>
            <Text style={[styles.confirmText, { color: theme.colors.text.inverse }]}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { justifyContent: 'center', margin: 16 },
  card: { borderRadius: 20, padding: 20 },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 8 },
  message: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  actions: { flexDirection: 'row', gap: 10 },
  cancel: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  confirm: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, fontWeight: '700' },
  confirmText: { fontSize: 15, fontWeight: '800' },
});