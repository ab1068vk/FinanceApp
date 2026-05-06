import React, { useMemo, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Modal from 'react-native-modal';
import Feather from '@expo/vector-icons/Feather';
import { addMonths, endOfMonth, format, getDay, startOfMonth, subMonths } from 'date-fns';
import { useTheme } from '../../theme';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  allowClear?: boolean;
};

function parseDateOnly(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function DatePickerField({ value, onChange, placeholder = 'Select date', style, allowClear = false }: Props) {
  const theme = useTheme();
  const selectedDate = parseDateOnly(value);
  const [visible, setVisible] = useState(false);
  const [month, setMonth] = useState(selectedDate || new Date());

  const days = useMemo(() => {
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    const blanks = Array.from({ length: getDay(start) }, () => null);
    const dates = Array.from({ length: end.getDate() }, (_, index) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), index + 1)));
    return [...blanks, ...dates];
  }, [month]);

  const close = () => setVisible(false);

  return (
    <>
      <Pressable style={[styles.field, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }, style]} onPress={() => setVisible(true)}>
        <Feather name="calendar" size={17} color={theme.colors.accent} />
        <Text style={[styles.value, { color: value ? theme.colors.text.primary : theme.colors.text.light }]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        {allowClear && value ? (
          <Pressable
            hitSlop={8}
            onPress={(event) => {
              event.stopPropagation();
              onChange('');
            }}
          >
            <Feather name="x" size={17} color={theme.colors.text.secondary} />
          </Pressable>
        ) : (
          <Feather name="chevron-down" size={17} color={theme.colors.text.secondary} />
        )}
      </Pressable>

      <Modal isVisible={visible} onBackdropPress={close} onBackButtonPress={close} style={styles.modal}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.header}>
            <Pressable style={styles.iconButton} onPress={() => setMonth((current) => subMonths(current, 1))}>
              <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
            </Pressable>
            <Text style={[styles.title, { color: theme.colors.text.primary }]}>{format(month, 'MMMM yyyy')}</Text>
            <Pressable style={styles.iconButton} onPress={() => setMonth((current) => addMonths(current, 1))}>
              <Feather name="chevron-right" size={22} color={theme.colors.text.primary} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <Text key={`${day}-${index}`} style={[styles.weekDay, { color: theme.colors.text.secondary }]}>{day}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {days.map((day, index) => {
              const selected = day && value === dateOnly(day);
              return (
                <Pressable
                  key={day ? dateOnly(day) : `blank-${index}`}
                  style={[styles.dayCell, selected && { backgroundColor: theme.colors.highlight }]}
                  disabled={!day}
                  onPress={() => {
                    if (!day) return;
                    onChange(dateOnly(day));
                    close();
                  }}
                >
                  <Text style={[styles.dayText, { color: selected ? theme.colors.text.inverse : theme.colors.text.primary }]}>
                    {day ? day.getUTCDate() : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.footer}>
            <Pressable style={[styles.footerButton, { borderColor: theme.colors.border }]} onPress={close}>
              <Text style={[styles.footerText, { color: theme.colors.text.primary }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.footerButton, { backgroundColor: theme.colors.highlight, borderColor: theme.colors.highlight }]}
              onPress={() => {
                onChange(dateOnly(new Date()));
                close();
              }}
            >
              <Text style={[styles.footerText, { color: theme.colors.text.inverse }]}>Today</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  value: { flex: 1, fontSize: 14, fontWeight: '700' },
  modal: { margin: 18, justifyContent: 'center' },
  card: { borderRadius: 18, padding: 16 },
  header: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '900' },
  weekRow: { flexDirection: 'row', marginTop: 8 },
  weekDay: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 12, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  dayText: { fontSize: 14, fontWeight: '800' },
  footer: { flexDirection: 'row', gap: 10, marginTop: 14 },
  footerButton: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  footerText: { fontSize: 14, fontWeight: '900' },
});
