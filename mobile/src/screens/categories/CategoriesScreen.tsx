import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Modal from 'react-native-modal';
import Feather from '@expo/vector-icons/Feather';
import { endOfMonth, startOfMonth } from 'date-fns';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import { ProfileStackParamList } from '../../navigation';
import api from '../../services/api';
import { useTheme } from '../../theme';
import { featherIconName } from '../../utils/icons';
import { ListPayload, unwrapList } from '../../types/api';
import type { FeatherIconName } from '../../utils/icons';

type Props = StackScreenProps<ProfileStackParamList, 'Categories'>;
type CategoryType = 'expense' | 'income';
type Category = {
  id: string;
  user_id?: string | null;
  name: string;
  icon?: string | null;
  color?: string | null;
  type: CategoryType;
  is_default?: number;
  sort_order?: number;
};
type SummaryGroup = { category_id?: string | null; category_name?: string; type?: CategoryType; total?: number };
type SummaryResponse = { grouped_by_category?: SummaryGroup[] };

const colorOptions = ['#E94560', '#0F3460', '#27AE60', '#F39C12', '#8B5CF6', '#14B8A6', '#E74C3C', '#64748B'];
const iconOptions: FeatherIconName[] = ['tag', 'coffee', 'truck', 'home', 'film', 'activity', 'shopping-cart', 'briefcase', 'trending-up', 'zap'];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
}

function sortCategories(categories: Category[]) {
  return [...categories].sort((left, right) => {
    if ((right.is_default || 0) !== (left.is_default || 0)) return (right.is_default || 0) - (left.is_default || 0);
    if ((left.sort_order || 0) !== (right.sort_order || 0)) return (left.sort_order || 0) - (right.sort_order || 0);
    return left.name.localeCompare(right.name);
  });
}

function currentMonthRange() {
  const now = new Date();
  return { start: startOfMonth(now).toISOString(), end: endOfMonth(now).toISOString() };
}

export default function CategoriesScreen({ navigation: _navigation }: Props) {
  const theme = useTheme();
  const [categories, setCategories] = useState<Category[]>([]);
  const [spending, setSpending] = useState<Record<string, number>>({});
  const [selectedType, setSelectedType] = useState<CategoryType>('expense');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryType>('expense');
  const [color, setColor] = useState(colorOptions[0]);
  const [icon, setIcon] = useState<FeatherIconName>('tag');

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const range = currentMonthRange();
      const [categoryResponse, summaryResponse] = await Promise.all([
        api.get<ListPayload<Category>>('/api/categories', { params: { page: 1, limit: 200 } }),
        api.get<SummaryResponse>('/api/transactions/summary', { params: { start_date: range.start, end_date: range.end } }),
      ]);

      setCategories(unwrapList(categoryResponse.data));
      const totals: Record<string, number> = {};
      (summaryResponse.data.grouped_by_category || []).forEach((item) => {
        if (item.category_id && item.type === 'expense') totals[item.category_id] = Number(item.total || 0);
      });
      setSpending(totals);
    } catch {
      showToast({ type: 'error', text1: 'Categories failed to load' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const visibleCategories = useMemo(
    () => sortCategories(categories.filter((category) => category.type === selectedType)),
    [categories, selectedType]
  );
  const customCategories = useMemo(
    () => sortCategories(categories.filter((category) => category.type === selectedType && !category.is_default)),
    [categories, selectedType]
  );
  const totalSpending = visibleCategories.reduce((sum, category) => sum + (spending[category.id] || 0), 0);

  const openCreate = () => {
    setEditingCategory(null);
    setName('');
    setType(selectedType);
    setColor(colorOptions[0]);
    setIcon('tag');
    setModalVisible(true);
  };

  const openEdit = (category: Category) => {
    if (category.is_default) return;
    setEditingCategory(category);
    setName(category.name);
    setType(category.type);
    setColor(category.color || colorOptions[0]);
    setIcon(featherIconName(category.icon, 'tag'));
    setModalVisible(true);
  };

  const saveCategory = async () => {
    if (name.trim().length < 1) {
      showToast({ type: 'error', text1: 'Category name required' });
      return;
    }

    setSaving(true);
    try {
      const payload = { name: name.trim(), type, icon, color };
      if (editingCategory) {
        await api.put(`/api/categories/${editingCategory.id}`, payload);
        showToast({ type: 'success', text1: 'Category updated' });
      } else {
        await api.post('/api/categories', payload);
        showToast({ type: 'success', text1: 'Category created' });
      }
      setModalVisible(false);
      await loadCategories();
    } catch (error) {
      showToast({ type: 'error', text1: editingCategory ? 'Update failed' : 'Create failed', text2: 'Check the category details and try again.' });
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = (category: Category) => {
    if (category.is_default) return;

    Alert.alert('Delete category?', `${category.name} will be removed from future category lists. Existing transactions and budgets will become uncategorized.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/api/categories/${category.id}`);
            showToast({ type: 'success', text1: 'Category deleted' });
            await loadCategories();
          } catch {
            showToast({ type: 'error', text1: 'Delete failed' });
          }
        },
      },
    ]);
  };

  const moveCategory = async (category: Category, direction: -1 | 1) => {
    const index = customCategories.findIndex((item) => item.id === category.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= customCategories.length) return;

    const reordered = [...customCategories];
    const currentCategory = reordered[index];
    const nextCategory = reordered[nextIndex];
    if (!currentCategory || !nextCategory) return;
    reordered[index] = nextCategory;
    reordered[nextIndex] = currentCategory;

    try {
      await api.put('/api/categories/reorder', { category_ids: reordered.map((item) => item.id) });
      setCategories((current) => current.map((item) => {
        const nextOrder = reordered.findIndex((ordered) => ordered.id === item.id);
        return nextOrder >= 0 ? { ...item, sort_order: (nextOrder + 1) * 10 } : item;
      }));
    } catch {
      showToast({ type: 'error', text1: 'Reorder failed' });
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadCategories} tintColor={theme.colors.highlight} colors={[theme.colors.highlight]} />}
      >
        <View style={styles.summaryCard}>
          <View>
            <Text style={styles.summaryLabel}>This month</Text>
            <Text style={styles.summaryValue}>{formatCurrency(totalSpending)}</Text>
            <Text style={styles.summarySubtext}>{visibleCategories.length} {selectedType} categories</Text>
          </View>
          <TouchableOpacity style={styles.addButton} onPress={openCreate} activeOpacity={0.82}>
            <Feather name="plus" size={20} color="#FFFFFF" />
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.typeRow}>
          {(['expense', 'income'] as CategoryType[]).map((item) => {
            const active = selectedType === item;
            return (
              <TouchableOpacity key={item} style={[styles.typePill, active && styles.typePillActive]} onPress={() => setSelectedType(item)}>
                <Text style={[styles.typeText, active && styles.typeTextActive]}>{item}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading && categories.length === 0 ? <ActivityIndicator color="#E94560" style={styles.loader} /> : null}

        {visibleCategories.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            amount={spending[category.id] || 0}
            maxAmount={Math.max(totalSpending, 1)}
            customIndex={customCategories.findIndex((item) => item.id === category.id)}
            customCount={customCategories.length}
            onEdit={() => openEdit(category)}
            onDelete={() => deleteCategory(category)}
            onMoveUp={() => moveCategory(category, -1)}
            onMoveDown={() => moveCategory(category, 1)}
          />
        ))}

        {!loading && visibleCategories.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="tag" size={36} color="#ADB5BD" />
            <Text style={styles.emptyTitle}>No categories yet</Text>
            <Text style={styles.emptyText}>Create a custom category to organize transactions.</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal isVisible={modalVisible} style={styles.modal} onBackdropPress={() => setModalVisible(false)} onBackButtonPress={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20} style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{editingCategory ? 'Edit Category' : 'New Category'}</Text>
            <TouchableOpacity onPress={() => setModalVisible(false)}><Feather name="x" size={24} color="#1A1A2E" /></TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Category name" maxLength={50} style={styles.input} />

          <Text style={styles.fieldLabel}>Type</Text>
          <View style={styles.typeRow}>
            {(['expense', 'income'] as CategoryType[]).map((item) => (
              <TouchableOpacity key={item} style={[styles.typePill, type === item && styles.typePillActive]} onPress={() => setType(item)}>
                <Text style={[styles.typeText, type === item && styles.typeTextActive]}>{item}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Icon</Text>
          <View style={styles.optionGrid}>
            {iconOptions.map((item) => (
              <TouchableOpacity key={item} style={[styles.iconChoice, icon === item && styles.iconChoiceActive]} onPress={() => setIcon(item)}>
                <Feather name={item} size={20} color={icon === item ? '#FFFFFF' : '#0F3460'} />
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Color</Text>
          <View style={styles.colorRow}>
            {colorOptions.map((item) => (
              <TouchableOpacity key={item} style={[styles.colorChoice, { backgroundColor: item }, color === item && styles.colorChoiceActive]} onPress={() => setColor(item)} />
            ))}
          </View>

          <TouchableOpacity style={[styles.saveButton, saving && styles.disabledButton]} onPress={saveCategory} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveButtonText}>{editingCategory ? 'Save Changes' : 'Create Category'}</Text>}
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function CategoryRow({
  category,
  amount,
  maxAmount,
  customIndex,
  customCount,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  category: Category;
  amount: number;
  maxAmount: number;
  customIndex: number;
  customCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const color = category.color || '#0F3460';
  const isCustom = !category.is_default;
  const progress = Math.min(1, amount / maxAmount);

  return (
    <View style={styles.categoryCard}>
      <View style={styles.categoryTop}>
        <View style={[styles.categoryIcon, { backgroundColor: `${color}18` }]}>
          <Feather name={featherIconName(category.icon, 'tag')} size={20} color={color} />
        </View>
        <View style={styles.categoryBody}>
          <View style={styles.categoryTitleRow}>
            <Text style={styles.categoryName} numberOfLines={1}>{category.name}</Text>
            <View style={[styles.sourceBadge, isCustom && styles.customBadge]}>
              <Text style={[styles.sourceText, isCustom && styles.customText]}>{isCustom ? 'Custom' : 'Default'}</Text>
            </View>
          </View>
          <View style={styles.spendingTrack}>
            <View style={[styles.spendingFill, { width: `${progress * 100}%`, backgroundColor: color }]} />
          </View>
          <Text style={styles.spendingText}>{formatCurrency(amount)} spent this month</Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity style={[styles.iconButton, (!isCustom || customIndex <= 0) && styles.iconButtonDisabled]} onPress={onMoveUp} disabled={!isCustom || customIndex <= 0}>
          <Feather name="arrow-up" size={17} color={isCustom && customIndex > 0 ? '#0F3460' : '#ADB5BD'} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.iconButton, (!isCustom || customIndex < 0 || customIndex >= customCount - 1) && styles.iconButtonDisabled]} onPress={onMoveDown} disabled={!isCustom || customIndex < 0 || customIndex >= customCount - 1}>
          <Feather name="arrow-down" size={17} color={isCustom && customIndex >= 0 && customIndex < customCount - 1 ? '#0F3460' : '#ADB5BD'} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.iconButton, !isCustom && styles.iconButtonDisabled]} onPress={onEdit} disabled={!isCustom}>
          <Feather name="edit-2" size={17} color={isCustom ? '#0F3460' : '#ADB5BD'} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.iconButton, !isCustom && styles.iconButtonDisabled]} onPress={onDelete} disabled={!isCustom}>
          <Feather name="trash-2" size={17} color={isCustom ? '#E74C3C' : '#ADB5BD'} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 20, paddingBottom: 40 },
  summaryCard: { borderRadius: 18, backgroundColor: '#FFFFFF', padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  summaryLabel: { color: '#6C757D', fontSize: 13, fontWeight: '800' },
  summaryValue: { color: '#1A1A2E', fontSize: 30, fontWeight: '900', marginTop: 6 },
  summarySubtext: { color: '#6C757D', fontSize: 13, fontWeight: '700', marginTop: 6, textTransform: 'capitalize' },
  addButton: { height: 42, borderRadius: 21, backgroundColor: '#E94560', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  addButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', marginLeft: 6 },
  typeRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  typePill: { flex: 1, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DEE2E6' },
  typePillActive: { backgroundColor: '#E94560', borderColor: '#E94560' },
  typeText: { color: '#6C757D', fontSize: 13, fontWeight: '900', textTransform: 'capitalize' },
  typeTextActive: { color: '#FFFFFF' },
  loader: { marginTop: 24 },
  categoryCard: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 14, marginTop: 14, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  categoryTop: { flexDirection: 'row', alignItems: 'center' },
  categoryIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  categoryBody: { flex: 1, minWidth: 0 },
  categoryTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  categoryName: { color: '#1A1A2E', fontSize: 16, fontWeight: '900', flex: 1 },
  sourceBadge: { borderRadius: 999, backgroundColor: '#EEF0F2', paddingHorizontal: 8, paddingVertical: 4, marginLeft: 8 },
  customBadge: { backgroundColor: '#EAF1F8' },
  sourceText: { color: '#6C757D', fontSize: 10, fontWeight: '900' },
  customText: { color: '#0F3460' },
  spendingTrack: { height: 7, borderRadius: 999, backgroundColor: '#EEF0F2', overflow: 'hidden' },
  spendingFill: { height: 7, borderRadius: 999 },
  spendingText: { color: '#6C757D', fontSize: 12, fontWeight: '800', marginTop: 8 },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  iconButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  iconButtonDisabled: { opacity: 0.6 },
  emptyState: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 32, marginTop: 20 },
  emptyTitle: { color: '#1A1A2E', fontSize: 17, fontWeight: '900', marginTop: 12 },
  emptyText: { color: '#6C757D', fontSize: 13, textAlign: 'center', marginTop: 6 },
  modal: { margin: 0, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { color: '#1A1A2E', fontSize: 24, fontWeight: '900' },
  fieldLabel: { color: '#1A1A2E', fontSize: 15, fontWeight: '900', marginTop: 18, marginBottom: 10 },
  input: { height: 48, borderRadius: 12, backgroundColor: '#F5F5F5', color: '#1A1A2E', paddingHorizontal: 14, fontWeight: '700' },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconChoice: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  iconChoiceActive: { backgroundColor: '#E94560' },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorChoice: { width: 34, height: 34, borderRadius: 17 },
  colorChoiceActive: { borderWidth: 3, borderColor: '#1A1A2E' },
  saveButton: { height: 52, borderRadius: 12, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  disabledButton: { opacity: 0.7 },
  saveButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});
