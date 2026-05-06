import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import api from '../../services/api';
import { saveUser } from '../../services/secureStorage';
import { authActions } from '../../store';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { ProfileStackParamList } from '../../navigation';

type Props = StackScreenProps<ProfileStackParamList, 'EditProfile'>;

const swatches = ['#0F3460', '#E94560', '#27AE60', '#F39C12', '#8B5CF6', '#14B8A6'];

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'FU';
}

export default function EditProfileScreen({ navigation }: Props) {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [avatarColor, setAvatarColor] = useState(String(user?.avatar_color || '#0F3460'));
  const isValid = useMemo(() => fullName.trim().length >= 2 && fullName.trim().length <= 50, [fullName]);

  const save = async () => {
    if (!user || !isValid) {
      showToast({ type: 'error', text1: 'Invalid name', text2: 'Name must be between 2 and 50 characters.' });
      return;
    }

    try {
      const response = await api.patch('/api/auth/me', { full_name: fullName.trim(), avatar_color: avatarColor });
      const updatedUser = { ...user, ...response.data };
      await saveUser(updatedUser);
      dispatch(authActions.setUser(updatedUser));
      showToast({ type: 'success', text1: 'Profile updated' });
      navigation.goBack();
    } catch {
      showToast({ type: 'error', text1: 'Update failed', text2: 'Could not save profile changes.' });
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.root}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}><Feather name="x" size={24} color="#1A1A2E" /></TouchableOpacity>
        <Text style={styles.title}>Edit Profile</Text>
        <TouchableOpacity style={styles.saveHeaderButton} onPress={save}><Text style={styles.saveHeaderText}>Save</Text></TouchableOpacity>
      </View>

      <View style={styles.content}>
        <LinearGradient colors={[avatarColor, '#16213E']} style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(fullName || user?.full_name || 'Finance User')}</Text>
        </LinearGradient>

        <Text style={styles.label}>Full name</Text>
        <TextInput value={fullName} onChangeText={setFullName} placeholder="Full name" style={[styles.input, !isValid && fullName.length > 0 && styles.inputError]} />
        {!isValid && fullName.length > 0 ? <Text style={styles.errorText}>Name must be between 2 and 50 characters.</Text> : null}

        <Text style={styles.label}>Avatar color</Text>
        <View style={styles.swatchRow}>
          {swatches.map((color) => (
            <TouchableOpacity key={color} style={[styles.swatch, { backgroundColor: color }, avatarColor === color && styles.swatchActive]} onPress={() => setAvatarColor(color)}>
              {avatarColor === color ? <Feather name="check" size={18} color="#FFFFFF" /> : null}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={[styles.saveButton, !isValid && styles.saveButtonDisabled]} onPress={save} disabled={!isValid}>
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { height: 72, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  closeButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#1A1A2E', fontSize: 20, fontWeight: '900' },
  saveHeaderButton: { minWidth: 42, alignItems: 'flex-end' },
  saveHeaderText: { color: '#E94560', fontSize: 15, fontWeight: '900' },
  content: { padding: 22, alignItems: 'center' },
  avatar: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  avatarText: { color: '#FFFFFF', fontSize: 38, fontWeight: '900' },
  label: { alignSelf: 'stretch', color: '#1A1A2E', fontSize: 15, fontWeight: '900', marginBottom: 10 },
  input: { alignSelf: 'stretch', height: 52, borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 14, color: '#1A1A2E', fontSize: 16, borderWidth: 1, borderColor: '#FFFFFF' },
  inputError: { borderColor: '#E74C3C' },
  errorText: { alignSelf: 'stretch', color: '#E74C3C', fontSize: 12, fontWeight: '700', marginTop: 6 },
  swatchRow: { alignSelf: 'stretch', flexDirection: 'row', gap: 12, marginBottom: 30 },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  swatchActive: { borderWidth: 3, borderColor: '#1A1A2E' },
  saveButton: { alignSelf: 'stretch', height: 52, borderRadius: 14, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  saveButtonDisabled: { opacity: 0.55 },
  saveButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});
