import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { StackScreenProps } from '@react-navigation/stack';
import api from '../../services/api';
import { showToast } from '../../components/common/Toast';
import { AuthStackParamList } from '../../navigation';

type Step = 'request' | 'reset';
type Props = StackScreenProps<AuthStackParamList, 'ForgotPassword'>;

type ForgotPasswordResponse = {
  success: boolean;
  message: string;
  resetToken?: string;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isStrongPassword(value: string) {
  return /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(value);
}

export default function ForgotPasswordScreen({ navigation, route }: Props) {
  const [step, setStep] = useState<Step>(route.params?.resetToken ? 'reset' : 'request');
  const [email, setEmail] = useState(route.params?.email || '');
  const [resetToken, setResetToken] = useState(route.params?.resetToken || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const requestValid = useMemo(() => isValidEmail(email), [email]);
  const tokenFromLink = Boolean(route.params?.resetToken);
  const resetValid = useMemo(
    () => resetToken.trim().length >= 32 && isStrongPassword(newPassword) && newPassword === confirmPassword,
    [confirmPassword, newPassword, resetToken]
  );

  useEffect(() => {
    if (!route.params?.resetToken) return;
    setResetToken(route.params.resetToken);
    setStep('reset');
  }, [route.params?.resetToken]);

  const requestReset = async () => {
    if (!requestValid) {
      showToast({ type: 'error', text1: 'Invalid email', text2: 'Enter the email address on your account.' });
      return;
    }

    try {
      setLoading(true);
      const response = await api.post<ForgotPasswordResponse>('/api/auth/forgot-password', { email: email.trim().toLowerCase() });
      if (response.data.resetToken) {
        setResetToken(response.data.resetToken);
        setStep('reset');
        showToast({ type: 'info', text1: 'Reset token ready', text2: 'A development reset token was filled in.' });
      } else {
        setStep('reset');
        showToast({ type: 'success', text1: 'Reset requested', text2: response.data.message });
      }
    } catch {
      showToast({ type: 'error', text1: 'Request failed', text2: 'Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    if (!resetValid) {
      showToast({ type: 'error', text1: 'Check reset details', text2: 'Token is required and passwords must match the rules.' });
      return;
    }

    try {
      setLoading(true);
      await api.post('/api/auth/reset-password', {
        resetToken: resetToken.trim(),
        newPassword,
      });
      showToast({ type: 'success', text1: 'Password reset', text2: 'You can sign in with your new password.' });
      setStep('request');
      setResetToken('');
      setNewPassword('');
      setConfirmPassword('');
      navigation.navigate('Login');
    } catch (error) {
      const message = typeof error === 'object' && error && 'response' in error
        ? String((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'The reset token is invalid or expired.')
        : 'The reset token is invalid or expired.';
      showToast({ type: 'error', text1: 'Reset failed', text2: message });
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.iconCircle}>
          <Feather name="key" size={30} color="#E94560" />
        </View>
        <Text style={styles.title}>{step === 'request' ? 'Forgot Password' : 'Reset Password'}</Text>
        <Text style={styles.subtitle}>
          {step === 'request'
            ? 'Enter your account email and we will send a secure reset link if the account exists.'
            : tokenFromLink
              ? 'Your secure reset link was detected. Choose a new password to finish.'
              : 'Paste the reset token from your email or administrator, then choose a new password.'}
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={(text) => setEmail(text.trim().toLowerCase())}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={!loading}
          inputMode="email"
          placeholder="Your email address"
          placeholderTextColor="#ADB5BD"
          spellCheck={false}
          style={styles.input}
          textContentType="emailAddress"
        />

        {step === 'reset' ? (
          <>
            {tokenFromLink ? (
              <View style={styles.linkDetected}>
                <Feather name="check-circle" size={18} color="#27AE60" />
                <Text style={styles.linkDetectedText}>Reset link verified</Text>
              </View>
            ) : (
              <>
                <Text style={styles.label}>Reset token</Text>
                <TextInput
                  value={resetToken}
                  onChangeText={setResetToken}
                  autoCapitalize="none"
                  editable={!loading}
                  placeholder="Paste reset token"
                  placeholderTextColor="#ADB5BD"
                  style={[styles.input, styles.tokenInput]}
                  multiline
                />
              </>
            )}

            <Text style={styles.label}>New password</Text>
            <View style={styles.passwordShell}>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                autoCapitalize="none"
                secureTextEntry={!showPassword}
                editable={!loading}
                placeholder="New password"
                placeholderTextColor="#ADB5BD"
                style={styles.passwordInput}
              />
              <TouchableOpacity onPress={() => setShowPassword((value) => !value)} disabled={loading}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={20} color="#6C757D" />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Confirm password</Text>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              autoCapitalize="none"
              secureTextEntry={!showPassword}
              editable={!loading}
              placeholder="Confirm password"
              placeholderTextColor="#ADB5BD"
              style={styles.input}
            />
            <Text style={styles.helper}>Use 8+ characters with uppercase, number, and special character.</Text>
          </>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, (loading || (step === 'request' ? !requestValid : !resetValid)) && styles.disabledButton]}
          onPress={step === 'request' ? requestReset : resetPassword}
          disabled={loading || (step === 'request' ? !requestValid : !resetValid)}
        >
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{step === 'request' ? 'Email Reset Link' : 'Reset Password'}</Text>}
        </TouchableOpacity>

        {step === 'reset' ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={requestReset} disabled={loading || !requestValid}>
            <Text style={styles.secondaryText}>Send a new token</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  iconCircle: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#E9456018', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { color: '#1A1A2E', fontSize: 28, fontWeight: '900' },
  subtitle: { color: '#6C757D', fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 22 },
  label: { color: '#1A1A2E', fontSize: 14, fontWeight: '900', marginTop: 14, marginBottom: 8 },
  input: { minHeight: 52, borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1A1A2E' },
  tokenInput: { minHeight: 86, textAlignVertical: 'top' },
  linkDetected: { height: 50, borderRadius: 14, backgroundColor: '#27AE6018', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 10 },
  linkDetectedText: { color: '#1A1A2E', fontSize: 14, fontWeight: '900' },
  passwordShell: { height: 52, borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, color: '#1A1A2E', fontSize: 15, height: 52 },
  helper: { color: '#6C757D', fontSize: 12, fontWeight: '700', marginTop: 8 },
  primaryButton: { marginTop: 22, height: 52, borderRadius: 14, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  disabledButton: { opacity: 0.55 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  secondaryButton: { alignItems: 'center', paddingVertical: 16 },
  secondaryText: { color: '#E94560', fontSize: 14, fontWeight: '900', textDecorationLine: 'underline' },
});
