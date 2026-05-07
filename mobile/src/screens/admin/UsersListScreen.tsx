import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { formatDistanceToNow } from 'date-fns';
import { useFocusEffect } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import { AdminStackParamList } from '../../navigation';
import api from '../../services/api';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchMoreUsers, fetchUsers, AdminUser, UsersFilters } from '../../store/slices/adminSlice';

type Props = StackScreenProps<AdminStackParamList, 'UsersList'>;
type Filter = 'all' | 'active' | 'inactive' | 'admin' | 'locked';

function initials(name?: string | null) {
  return (name?.trim() || 'User').split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
}

function displayName(user: AdminUser) {
  return user.full_name?.trim() || 'Unnamed User';
}

function lastLogin(value?: string | null) {
  if (!value) return 'Never';
  return `${formatDistanceToNow(new Date(value), { addSuffix: true })}`;
}

export default function UsersListScreen({ navigation, route }: Props) {
  const dispatch = useAppDispatch();
  const users = useAppSelector((state) => state.admin.users);
  const usersLoading = useAppSelector((state) => state.admin.usersLoading);
  const usersLoadingMore = useAppSelector((state) => state.admin.usersLoadingMore);
  const pagination = useAppSelector((state) => state.admin.pagination.users);
  const error = useAppSelector((state) => state.admin.error);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>(route.params?.initialFilter ?? 'all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionMode = selectedIds.size > 0;
  const filtersActive = Boolean(search.trim() || filter !== 'all');

  const loadUsers = useCallback(() => {
    const params: UsersFilters = { search: search.trim() || undefined };
    if (filter === 'active') params.is_active = true;
    if (filter === 'inactive') params.is_active = false;
    if (filter === 'admin') params.role = 'admin';
    if (filter === 'locked') params.locked = true;
    dispatch(fetchUsers(params));
  }, [dispatch, search, filter]);

  const loadMoreUsers = useCallback(() => {
    if (usersLoading || usersLoadingMore || pagination.page >= pagination.totalPages) return;
    const params: UsersFilters = { search: search.trim() || undefined, page: pagination.page + 1, limit: pagination.limit || 20 };
    if (filter === 'active') params.is_active = true;
    if (filter === 'inactive') params.is_active = false;
    if (filter === 'admin') params.role = 'admin';
    if (filter === 'locked') params.locked = true;
    dispatch(fetchMoreUsers(params));
  }, [dispatch, filter, pagination.limit, pagination.page, pagination.totalPages, search, usersLoading, usersLoadingMore]);

  useEffect(() => {
    const timer = setTimeout(loadUsers, 250);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  useEffect(() => {
    if (route.params?.initialFilter) setFilter(route.params.initialFilter);
  }, [route.params?.initialFilter]);

  useFocusEffect(
    useCallback(() => {
      loadUsers();
    }, [loadUsers]),
  );

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk(action: 'activate' | 'deactivate' | 'force_password_reset') {
    try {
      await api.post('/api/admin/users/bulk', {
        user_ids: Array.from(selectedIds),
        action,
        reason: `Bulk ${action.replace(/_/g, ' ')} from admin users list`,
      });
      showToast({ type: 'success', text1: 'Bulk action complete' });
      setSelectedIds(new Set());
      loadUsers();
    } catch (error) {
      showToast({ type: 'error', text1: 'Bulk action failed' });
    }
  }

  function clearFilters() {
    setSearch('');
    setFilter('all');
    setSelectedIds(new Set());
    showToast({ type: 'success', text1: 'Filters cleared' });
  }

  return (
    <View style={styles.root}>
      <View style={styles.searchBlock}>
        <View style={styles.searchBar}>
          <Feather name="search" size={20} color="#6C757D" />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search users" placeholderTextColor="#ADB5BD" style={styles.searchInput} />
        </View>
        <TouchableOpacity
          style={[styles.filterButton, filtersActive && styles.filterButtonActive]}
          onPress={clearFilters}
        >
          <Feather name={filtersActive ? 'x' : 'sliders'} size={20} color={filtersActive ? '#FFFFFF' : '#0F3460'} />
        </TouchableOpacity>
      </View>

      <View style={styles.chipRow}>{(['all', 'active', 'inactive', 'admin', 'locked'] as Filter[]).map((item) => <TouchableOpacity key={item} style={[styles.chip, filter === item && styles.chipActive]} onPress={() => setFilter(item)}><Text style={[styles.chipText, filter === item && styles.chipTextActive]}>{item}</Text></TouchableOpacity>)}</View>

      {selectionMode ? (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkText}>{selectedIds.size} selected</Text>
          <TouchableOpacity style={styles.bulkButton} onPress={() => runBulk('activate')}><Text style={styles.bulkButtonText}>Activate</Text></TouchableOpacity>
          <TouchableOpacity style={styles.bulkButton} onPress={() => runBulk('deactivate')}><Text style={styles.bulkButtonText}>Deactivate</Text></TouchableOpacity>
          <TouchableOpacity style={styles.bulkButton} onPress={() => runBulk('force_password_reset')}><Text style={styles.bulkButtonText}>Reset</Text></TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        refreshing={usersLoading}
        onRefresh={loadUsers}
        onEndReached={loadMoreUsers}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <UserCard
            user={item}
            selected={selectedIds.has(item.id)}
            onPress={() => selectionMode ? toggleSelection(item.id) : navigation.navigate('UserDetail', { id: item.id })}
            onLongPress={() => toggleSelection(item.id)}
          />
        )}
        ListEmptyComponent={!usersLoading ? <Text style={[styles.emptyText, error && styles.errorText]}>{error || 'No users match these filters.'}</Text> : null}
        ListFooterComponent={usersLoadingMore ? <ActivityIndicator color="#E94560" style={styles.footerLoader} /> : null}
      />
    </View>
  );
}

function UserCard({ user, selected, onPress, onLongPress }: { user: AdminUser; selected: boolean; onPress: () => void; onLongPress: () => void }) {
  const active = Boolean(user.is_active);
  const name = displayName(user);
  return (
    <TouchableOpacity style={[styles.userCard, selected && styles.userCardSelected]} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.82}>
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(name)}</Text></View>
        <View style={[styles.statusDot, { backgroundColor: active ? '#27AE60' : '#E74C3C' }]} />
      </View>
      <View style={styles.userCenter}>
        <Text style={styles.userName}>{name}</Text>
        <Text style={styles.userEmail}>{user.email}</Text>
        <Text style={styles.metaText}>Last login: {lastLogin(user.last_login)}</Text>
      </View>
      <View style={styles.userRight}>
        <View style={[styles.roleBadge, user.role === 'admin' ? styles.adminBadge : styles.userBadge]}><Text style={styles.roleText}>{user.role}</Text></View>
        <Text style={styles.transactionCount}>{user.transaction_count || 0} txns</Text>
      </View>
      <Feather name="chevron-right" size={20} color="#ADB5BD" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  searchBlock: { flexDirection: 'row', padding: 20, paddingBottom: 12 },
  searchBar: { flex: 1, height: 48, borderRadius: 14, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  searchInput: { flex: 1, marginLeft: 10, color: '#1A1A2E', fontSize: 15 },
  filterButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  filterButtonActive: { backgroundColor: '#E94560' },
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  chip: { borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DEE2E6', paddingHorizontal: 13, paddingVertical: 8 },
  chipActive: { backgroundColor: '#E94560', borderColor: '#E94560' },
  chipText: { color: '#6C757D', fontSize: 12, fontWeight: '900', textTransform: 'capitalize' },
  chipTextActive: { color: '#FFFFFF' },
  listContent: { padding: 20, paddingTop: 4, paddingBottom: 30 },
  userCard: { minHeight: 92, borderRadius: 16, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 12, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  userCardSelected: { borderWidth: 2, borderColor: '#E94560' },
  avatarWrap: { marginRight: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#0F3460', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  statusDot: { position: 'absolute', right: 0, bottom: 2, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: '#FFFFFF' },
  userCenter: { flex: 1, minWidth: 0 },
  userName: { color: '#1A1A2E', fontSize: 15, fontWeight: '900' },
  userEmail: { color: '#6C757D', fontSize: 13, marginTop: 4 },
  metaText: { color: '#ADB5BD', fontSize: 12, marginTop: 5, fontWeight: '700' },
  userRight: { alignItems: 'flex-end', marginHorizontal: 8 },
  roleBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, marginBottom: 8 },
  adminBadge: { backgroundColor: '#E94560' },
  userBadge: { backgroundColor: '#0F3460' },
  roleText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', textTransform: 'capitalize' },
  transactionCount: { color: '#6C757D', fontSize: 12, fontWeight: '800' },
  emptyText: { color: '#6C757D', fontSize: 14, fontWeight: '800', textAlign: 'center', paddingTop: 40 },
  errorText: { color: '#E74C3C' },
  bulkBar: { marginHorizontal: 20, marginBottom: 12, borderRadius: 14, padding: 10, backgroundColor: '#1A1A2E', flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulkText: { flex: 1, color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  bulkButton: { borderRadius: 999, backgroundColor: '#E94560', paddingHorizontal: 10, paddingVertical: 7 },
  bulkButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  footerLoader: { marginVertical: 18 },
});
