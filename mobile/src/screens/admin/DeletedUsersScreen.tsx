import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { format } from 'date-fns';
import { StackScreenProps } from '@react-navigation/stack';
import { useFocusEffect } from '@react-navigation/native';
import { AdminStackParamList } from '../../navigation';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { DeletedUser, fetchDeletedUserDetail, fetchDeletedUsers } from '../../store/slices/adminSlice';

type Props = StackScreenProps<AdminStackParamList, 'DeletedUsers'>;

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
}

function niceDate(value?: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : format(date, 'MMM d, yyyy h:mm a');
}

export default function DeletedUsersScreen({}: Props) {
  const dispatch = useAppDispatch();
  const { deletedUsers, selectedDeletedUser, deletedUsersLoading, isLoading, error } = useAppSelector((state) => state.admin);
  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  const loadDeletedUsers = useCallback(() => {
    dispatch(fetchDeletedUsers({ search: search.trim() || undefined }));
  }, [dispatch, search]);

  useEffect(() => {
    const timer = setTimeout(loadDeletedUsers, 250);
    return () => clearTimeout(timer);
  }, [loadDeletedUsers]);

  useFocusEffect(
    useCallback(() => {
      loadDeletedUsers();
    }, [loadDeletedUsers]),
  );

  const openDeletedUser = async (user: DeletedUser) => {
    setModalVisible(true);
    await dispatch(fetchDeletedUserDetail(user.id));
  };

  return (
    <View style={styles.root}>
      <View style={styles.searchBlock}>
        <View style={styles.searchBar}>
          <Feather name="search" size={20} color="#6C757D" />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search deleted users" placeholderTextColor="#ADB5BD" style={styles.searchInput} />
        </View>
      </View>

      <FlatList
        data={deletedUsers}
        keyExtractor={(item) => item.id}
        refreshing={deletedUsersLoading}
        onRefresh={loadDeletedUsers}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <DeletedUserCard user={item} onPress={() => openDeletedUser(item)} />}
        ListEmptyComponent={!deletedUsersLoading ? <Text style={[styles.emptyText, error && styles.errorText]}>{error || 'No deleted users archived yet.'}</Text> : null}
      />

      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.closeButton} onPress={() => setModalVisible(false)}>
              <Feather name="x" size={24} color="#1A1A2E" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Deleted User Details</Text>
            <View style={styles.closeButton} />
          </View>
          {isLoading && !selectedDeletedUser ? (
            <View style={styles.centered}><ActivityIndicator color="#E94560" /></View>
          ) : selectedDeletedUser ? (
            <ScrollView contentContainerStyle={styles.modalContent}>
              <View style={styles.detailCard}>
                <Text style={styles.detailName}>{selectedDeletedUser.user.full_name}</Text>
                <Text style={styles.detailEmail}>{selectedDeletedUser.user.email}</Text>
                <Text style={styles.detailMeta}>Deleted {niceDate(selectedDeletedUser.user.deleted_at)}</Text>
              </View>
              <View style={styles.grid}>
                <Metric label="Accounts" value={String(selectedDeletedUser.user.account_count)} />
                <Metric label="Transactions" value={String(selectedDeletedUser.user.transaction_count)} />
                <Metric label="Budgets" value={String(selectedDeletedUser.user.budget_count)} />
                <Metric label="Balance" value={formatCurrency(selectedDeletedUser.user.total_account_balance)} />
              </View>
              <Section title="Account Snapshot" count={selectedDeletedUser.details.accounts?.length || 0} />
              <Section title="Transaction Snapshot" count={selectedDeletedUser.details.transactions?.length || 0} />
              <Section title="Budget Snapshot" count={selectedDeletedUser.details.budgets?.length || 0} />
              <Section title="Audit Snapshot" count={selectedDeletedUser.details.audit_logs?.length || 0} />
            </ScrollView>
          ) : (
            <Text style={styles.emptyText}>Deleted user details are unavailable.</Text>
          )}
        </View>
      </Modal>
    </View>
  );
}

function DeletedUserCard({ user, onPress }: { user: DeletedUser; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.userCard} onPress={onPress} activeOpacity={0.82}>
      <View style={styles.archiveIcon}><Feather name="archive" size={22} color="#E94560" /></View>
      <View style={styles.userCenter}>
        <Text style={styles.userName}>{user.full_name}</Text>
        <Text style={styles.userEmail}>{user.email}</Text>
        <Text style={styles.metaText}>Deleted: {niceDate(user.deleted_at)}</Text>
      </View>
      <View style={styles.userRight}>
        <Text style={styles.transactionCount}>{user.transaction_count || 0} txns</Text>
        <Text style={styles.transactionCount}>{user.account_count || 0} accts</Text>
      </View>
      <Feather name="chevron-right" size={20} color="#ADB5BD" />
    </TouchableOpacity>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

function Section({ title, count }: { title: string; count: number }) {
  return <View style={styles.snapshotRow}><Text style={styles.snapshotTitle}>{title}</Text><Text style={styles.snapshotCount}>{count}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  searchBlock: { padding: 20, paddingBottom: 12 },
  searchBar: { height: 48, borderRadius: 14, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  searchInput: { flex: 1, marginLeft: 10, color: '#1A1A2E', fontSize: 15 },
  listContent: { padding: 20, paddingTop: 4, paddingBottom: 30 },
  userCard: { minHeight: 92, borderRadius: 16, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 12, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  archiveIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#E9456018', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  userCenter: { flex: 1, minWidth: 0 },
  userName: { color: '#1A1A2E', fontSize: 15, fontWeight: '900' },
  userEmail: { color: '#6C757D', fontSize: 13, marginTop: 4 },
  metaText: { color: '#ADB5BD', fontSize: 12, marginTop: 5, fontWeight: '700' },
  userRight: { alignItems: 'flex-end', marginHorizontal: 8 },
  transactionCount: { color: '#6C757D', fontSize: 12, fontWeight: '800', marginBottom: 4 },
  emptyText: { color: '#6C757D', fontSize: 14, fontWeight: '800', textAlign: 'center', paddingTop: 40 },
  errorText: { color: '#E74C3C' },
  modalRoot: { flex: 1, backgroundColor: '#F8F9FA' },
  modalHeader: { height: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, backgroundColor: '#FFFFFF' },
  closeButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: '#1A1A2E', fontSize: 18, fontWeight: '900' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modalContent: { padding: 20, paddingBottom: 34 },
  detailCard: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 18, marginBottom: 14 },
  detailName: { color: '#1A1A2E', fontSize: 22, fontWeight: '900' },
  detailEmail: { color: '#6C757D', fontSize: 14, fontWeight: '700', marginTop: 6 },
  detailMeta: { color: '#E94560', fontSize: 13, fontWeight: '900', marginTop: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  metric: { width: '48%', borderRadius: 14, backgroundColor: '#FFFFFF', padding: 14 },
  metricLabel: { color: '#6C757D', fontSize: 12, fontWeight: '800' },
  metricValue: { color: '#1A1A2E', fontSize: 18, fontWeight: '900', marginTop: 8 },
  snapshotRow: { borderRadius: 14, backgroundColor: '#FFFFFF', padding: 15, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  snapshotTitle: { color: '#1A1A2E', fontSize: 14, fontWeight: '900' },
  snapshotCount: { color: '#E94560', fontSize: 14, fontWeight: '900' },
});
