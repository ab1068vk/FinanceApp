import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect } from '@react-navigation/native';
import api from '../../services/api';
import { showToast } from '../../components/common/Toast';
import { useTheme } from '../../theme';
import type { FeatherIconName } from '../../utils/icons';

type DefaultCategory = {
  id: string;
  name: string;
  type: 'income' | 'expense';
  icon?: string | null;
  color?: string | null;
  is_default: number;
  is_system: number;
  is_active: number;
  sort_order: number;
};

const iconChoices: FeatherIconName[] = ['tag', 'shopping-bag', 'home', 'truck', 'heart', 'coffee', 'briefcase', 'gift', 'dollar-sign', 'trending-up', 'credit-card', 'file-text'];
const colorChoices = ['#E94560', '#27AE60', '#0F3460', '#F39C12', '#8E44AD', '#14B8A6', '#3498DB', '#2C3E50'];

export default function DefaultCategoriesScreen() {
  const theme = useTheme();
  const [categories, setCategories] = useState<DefaultCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<DefaultCategory | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [icon, setIcon] = useState<FeatherIconName>('tag');
  const [color, setColor] = useState('#E94560');
  const [sortOrder, setSortOrder] = useState('10');

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    form: { padding: theme.spacing.md, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    formTitle: { color: theme.colors.text.primary, fontSize: theme.typography.lg, fontWeight: '900', marginBottom: theme.spacing.sm },
    input: { height: 46, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text.primary, backgroundColor: theme.colors.background, paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
    row: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center', flexWrap: 'wrap' },
    typeChip: { flex: 1, minWidth: 110, height: 42, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
    chipActive: { borderColor: theme.colors.highlight, backgroundColor: theme.colors.highlight },
    chipText: { color: theme.colors.text.secondary, fontWeight: '800', textTransform: 'capitalize' },
    chipTextActive: { color: theme.colors.text.inverse },
    pickerLabel: { color: theme.colors.text.secondary, fontSize: theme.typography.sm, fontWeight: '800', marginTop: theme.spacing.xs, marginBottom: theme.spacing.xs },
    iconChoice: { width: 42, height: 42, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' },
    iconChoiceActive: { borderColor: theme.colors.highlight, backgroundColor: '#FDECEC' },
    colorChoice: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: theme.colors.surface },
    colorChoiceActive: { borderColor: theme.colors.text.primary },
    primaryButton: { minHeight: 42, borderRadius: theme.borderRadius.sm, backgroundColor: theme.colors.highlight, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, flex: 1 },
    secondaryButton: { minHeight: 42, borderRadius: theme.borderRadius.sm, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md },
    pushButton: { marginTop: theme.spacing.sm, minHeight: 42, borderRadius: theme.borderRadius.sm, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md },
    buttonText: { color: theme.colors.text.inverse, fontWeight: '800' },
    secondaryText: { color: theme.colors.text.primary, fontWeight: '800' },
    list: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl },
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm, ...theme.shadows.small },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
    titleWrap: { flex: 1, minWidth: 0 },
    title: { color: theme.colors.text.primary, fontSize: theme.typography.md, fontWeight: '800' },
    meta: { color: theme.colors.text.secondary, fontSize: theme.typography.sm, marginTop: theme.spacing.xs },
    preview: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
    badge: { borderRadius: theme.borderRadius.full, paddingHorizontal: theme.spacing.sm, paddingVertical: 3, alignSelf: 'flex-start' },
    badgeText: { color: theme.colors.text.inverse, fontSize: theme.typography.xs, fontWeight: '800' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
    dangerButton: { backgroundColor: theme.colors.danger, borderColor: theme.colors.danger },
    empty: { alignItems: 'center', padding: theme.spacing.xl },
  }), [theme]);

  const resetForm = useCallback(() => {
    setEditing(null);
    setName('');
    setType('expense');
    setIcon('tag');
    setColor('#E94560');
    setSortOrder('10');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<{ data: DefaultCategory[] }>('/api/admin/default-categories');
      setCategories(response.data.data || []);
    } catch {
      showToast({ type: 'error', text1: 'Default categories failed to load' });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function editCategory(category: DefaultCategory) {
    setEditing(category);
    setName(category.name);
    setType(category.type);
    setIcon((category.icon as FeatherIconName) || 'tag');
    setColor(category.color || '#E94560');
    setSortOrder(String(category.sort_order || 10));
  }

  async function saveCategory() {
    if (!name.trim()) {
      showToast({ type: 'error', text1: 'Category name is required' });
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      type,
      icon,
      color,
      sort_order: Number(sortOrder) || 10,
      is_system: true,
      is_default: true,
    };
    try {
      if (editing) {
        await api.put(`/api/admin/default-categories/${editing.id}`, payload);
        showToast({ type: 'success', text1: 'Default category updated' });
      } else {
        await api.post('/api/admin/default-categories', payload);
        showToast({ type: 'success', text1: 'Default category added', text2: 'Active defaults are visible to users automatically.' });
      }
      resetForm();
      load();
    } catch {
      showToast({ type: 'error', text1: editing ? 'Category was not updated' : 'Category was not added' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleCategory(category: DefaultCategory) {
    try {
      await api.put(`/api/admin/default-categories/${category.id}`, { is_active: !category.is_active });
      load();
    } catch {
      showToast({ type: 'error', text1: 'Category update failed' });
    }
  }

  function deleteCategory(category: DefaultCategory) {
    Alert.alert('Delete default category?', `${category.name} will be removed from active defaults for users.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/api/admin/default-categories/${category.id}`);
            if (editing?.id === category.id) resetForm();
            showToast({ type: 'success', text1: 'Default category deleted' });
            load();
          } catch {
            showToast({ type: 'error', text1: 'Category was not deleted' });
          }
        },
      },
    ]);
  }

  async function pushDefaults() {
    try {
      const response = await api.post<{ inserted: number; skipped: number }>('/api/admin/default-categories/push');
      showToast({ type: 'success', text1: 'Defaults synced', text2: `${response.data.inserted} added, ${response.data.skipped} already visible.` });
    } catch {
      showToast({ type: 'error', text1: 'Push failed' });
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.form}>
        <Text style={styles.formTitle}>{editing ? 'Edit Default Category' : 'Add Default Category'}</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Category name" placeholderTextColor={theme.colors.text.light} style={styles.input} />
        <View style={styles.row}>
          {(['expense', 'income'] as const).map((item) => (
            <Pressable key={item} style={[styles.typeChip, type === item && styles.chipActive]} onPress={() => setType(item)}>
              <Text style={[styles.chipText, type === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
          <TextInput value={sortOrder} onChangeText={setSortOrder} placeholder="Order" placeholderTextColor={theme.colors.text.light} style={[styles.input, { width: 86, marginBottom: 0 }]} keyboardType="number-pad" />
        </View>

        <Text style={styles.pickerLabel}>Icon</Text>
        <View style={styles.row}>
          {iconChoices.map((item) => (
            <Pressable key={item} style={[styles.iconChoice, icon === item && styles.iconChoiceActive]} onPress={() => setIcon(item)}>
              <Feather name={item} size={19} color={icon === item ? theme.colors.highlight : theme.colors.text.secondary} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.pickerLabel}>Color</Text>
        <View style={styles.row}>
          {colorChoices.map((item) => (
            <Pressable key={item} style={[styles.colorChoice, color === item && styles.colorChoiceActive, { backgroundColor: item }]} onPress={() => setColor(item)} />
          ))}
        </View>

        <View style={[styles.row, { marginTop: theme.spacing.sm }]}>
          <Pressable style={styles.primaryButton} onPress={saveCategory} disabled={saving}>
            <Feather name={editing ? 'save' : 'plus'} size={17} color={theme.colors.text.inverse} />
            <Text style={styles.buttonText}>{editing ? 'Save Changes' : 'Add Category'}</Text>
          </Pressable>
          {editing ? (
            <Pressable style={styles.secondaryButton} onPress={resetForm} disabled={saving}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable style={styles.pushButton} onPress={pushDefaults}>
          <Feather name="send" size={17} color={theme.colors.text.inverse} />
          <Text style={styles.buttonText}>Sync Missing Defaults</Text>
        </Pressable>
      </View>

      {loading && !categories.length ? <View style={styles.empty}><ActivityIndicator color={theme.colors.highlight} /></View> : (
        <FlatList
          data={categories}
          keyExtractor={(item) => item.id}
          refreshing={loading}
          onRefresh={load}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.top}>
                <View style={[styles.preview, { backgroundColor: item.color || theme.colors.highlight }]}>
                  <Feather name={(item.icon as FeatherIconName) || 'tag'} size={20} color={theme.colors.text.inverse} />
                </View>
                <View style={styles.titleWrap}>
                  <Text style={styles.title}>{item.name}</Text>
                  <Text style={styles.meta}>{item.type} - order {item.sort_order}</Text>
                </View>
                <Switch value={Boolean(item.is_active)} onValueChange={() => toggleCategory(item)} />
              </View>
              <View style={styles.badgeRow}>
                <View style={[styles.badge, { backgroundColor: item.is_system ? theme.colors.highlight : theme.colors.accent }]}>
                  <Text style={styles.badgeText}>{item.is_system ? 'system' : 'default'}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: item.is_active ? theme.colors.success : theme.colors.danger }]}>
                  <Text style={styles.badgeText}>{item.is_active ? 'active' : 'inactive'}</Text>
                </View>
              </View>
              <View style={styles.actions}>
                <Pressable style={styles.secondaryButton} onPress={() => editCategory(item)}>
                  <Feather name="edit-2" size={16} color={theme.colors.text.primary} />
                  <Text style={styles.secondaryText}>Edit</Text>
                </Pressable>
                <Pressable style={[styles.secondaryButton, styles.dangerButton]} onPress={() => deleteCategory(item)}>
                  <Feather name="trash-2" size={16} color={theme.colors.text.inverse} />
                  <Text style={styles.buttonText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}
