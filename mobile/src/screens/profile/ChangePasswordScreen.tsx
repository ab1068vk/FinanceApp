import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import api from '../../services/api';
import { clearTokens } from '../../services/secureStorage';
import { authActions } from '../../store';
import { useAppDispatch } from '../../store/hooks';
import { ProfileStackParamList, RootStackParamList } from '../../navigation';

type Props =
  | StackScreenProps<ProfileStackParamList, 'ChangePassword'>
  | StackScreenProps<RootStackParamList, 'ForceChangePassword'>;

function checks(password: string) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

export default function ChangePasswordScreen({ navigation, route }: Props) {
  const dispatch = useAppDispatch();
  const isForceChange = route.name === 'ForceChangePassword';
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const passwordChecks = useMemo(() => checks(newPassword), [newPassword]);
  const strength = Object.values(passwordChecks).filter(Boolean).length;
  const valid = currentPassword.length > 0 && strength === 4 && newPassword === confirmPassword;

  useEffect(() => {
    if (!isForceChange) return undefined;

    navigation.setOptions({
      gestureEnabled: false,
      headerLeft: () => null,
    });

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => backHandler.remove();
  }, [isForceChange, navigation]);

  const submit = async () => {
    if (!valid) {
      showToast({ type: 'error', text1: 'Check password requirements', text2: 'New passwords must match and meet all rules.' });
      return;
    }

    setLoading(true);
    try {
      await api.put('/api/auth/change-password', { currentPassword, newPassword });
      await clearTokens();
      dispatch(authActions.logout());
      showToast({ type: 'success', text1: 'Password changed', text2: 'Other sessions were revoked. Please sign in again.' });
    } catch (error) {
      showToast({ type: 'error', text1: 'Unable to change password', text2: 'Verify your current password and try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.root}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Secure your account</Text>
        <Text style={styles.subtitle}>Changing your password revokes all refresh tokens for this account.</Text>

        <PasswordInput label="Current password" value={currentPassword} onChangeText={setCurrentPassword} visible={visible} />
        <PasswordInput label="New password" value={newPassword} onChangeText={setNewPassword} visible={visible} />

        <View style={styles.strengthRow}>
          {[0, 1, 2, 3].map((segment) => <View key={segment} style={[styles.strengthSegment, { backgroundColor: strength > segment ? ['#E74C3C', '#F39C12', '#F1C40F', '#27AE60'][segment] : '#DEE2E6' }]} />)}
        </View>

        <View style={styles.requirements}>
          <Requirement label="8+ characters" met={passwordChecks.length} />
          <Requirement label="Uppercase letter" met={passwordChecks.uppercase} />
          <Requirement label="Number" met={passwordChecks.number} />
          <Requirement label="Special character" met={passwordChecks.special} />
        </View>

        <PasswordInput label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} visible={visible} />
        {confirmPassword.length > 0 && newPassword !== confirmPassword ? <Text style={styles.errorText}>Passwords must match.</Text> : null}

        <TouchableOpacity style={styles.visibilityToggle} onPress={() => setVisible((value) => !value)}>
          <Feather name={visible ? 'eye-off' : 'eye'} size={18} color="#0F3460" />
          <Text style={styles.visibilityText}>{visible ? 'Hide passwords' : 'Show passwords'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.submitButton, (!valid || loading) && styles.submitButtonDisabled]} onPress={submit} disabled={!valid || loading}>
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitText}>Change Password</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PasswordInput({ label, value, onChangeText, visible }: { label: string; value: string; onChangeText: (value: string) => void; visible: boolean }) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputShell}>
        <Feather name="lock" size={20} color="#0F3460" style={styles.inputIcon} />
        <TextInput value={value} onChangeText={onChangeText} secureTextEntry={!visible} placeholder={label} placeholderTextColor="#ADB5BD" style={styles.input} autoCapitalize="none" />
      </View>
    </View>
  );
}

function Requirement({ label, met }: { label: string; met: boolean }) {
  return <View style={styles.requirementRow}><Feather name={met ? 'check-circle' : 'circle'} size={16} color={met ? '#27AE60' : '#ADB5BD'} /><Text style={[styles.requirementText, met && styles.requirementMet]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { padding: 22, paddingBottom: 40 },
  title: { color: '#1A1A2E', fontSize: 26, fontWeight: '900' },
  subtitle: { color: '#6C757D', fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 24 },
  fieldBlock: { marginBottom: 16 },
  label: { color: '#1A1A2E', fontSize: 14, fontWeight: '900', marginBottom: 8 },
  inputShell: { height: 52, borderRadius: 14, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: '#1A1A2E', fontSize: 15 },
  strengthRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  strengthSegment: { flex: 1, height: 7, borderRadius: 999 },
  requirements: { gap: 9, marginBottom: 18 },
  requirementRow: { flexDirection: 'row', alignItems: 'center' },
  requirementText: { color: '#6C757D', fontSize: 13, fontWeight: '700', marginLeft: 8 },
  requirementMet: { color: '#1A1A2E', fontWeight: '900' },
  errorText: { color: '#E74C3C', fontSize: 12, fontWeight: '800', marginTop: -8, marginBottom: 14 },
  visibilityToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 24 },
  visibilityText: { color: '#0F3460', fontSize: 14, fontWeight: '900', marginLeft: 8 },
  submitButton: { height: 54, borderRadius: 14, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  submitButtonDisabled: { opacity: 0.55 },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
});
