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

type Props = StackScreenProps<AuthStackParamList, 'VerifyEmail'>;

type VerificationResponse = {
  success: boolean;
  message: string;
  verificationToken?: string;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function VerifyEmailScreen({ navigation, route }: Props) {
  const [email, setEmail] = useState(route.params?.email || '');
  const [verificationToken, setVerificationToken] = useState(route.params?.verificationToken || '');
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);

  const canVerify = useMemo(() => verificationToken.trim().length >= 32, [verificationToken]);
  const canResend = useMemo(() => isValidEmail(email) && resendSeconds <= 0, [email, resendSeconds]);

  useEffect(() => {
    if (!route.params?.verificationToken) return;
    verifyEmail(route.params.verificationToken);
  }, [route.params?.verificationToken]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds((value) => Math.max(value - 1, 0)), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  const verifyEmail = async (token = verificationToken) => {
    if (token.trim().length < 32) {
      showToast({ type: 'error', text1: 'Verification link needed', text2: 'Open the email link or paste the verification token.' });
      return;
    }

    try {
      setLoading(true);
      await api.post('/api/auth/verify-email', { verificationToken: token.trim() });
      setVerified(true);
      showToast({ type: 'success', text1: 'Email verified', text2: 'You can sign in now.' });
    } catch (error) {
      const message = typeof error === 'object' && error && 'response' in error
        ? String((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'The verification link is invalid or expired.')
        : 'The verification link is invalid or expired.';
      showToast({ type: 'error', text1: 'Verification failed', text2: message });
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    if (!isValidEmail(email)) {
      showToast({ type: 'error', text1: 'Invalid email', text2: 'Enter the email address on your account.' });
      return;
    }

    try {
      setLoading(true);
      const response = await api.post<VerificationResponse>('/api/auth/resend-verification', { email: email.trim().toLowerCase() });
      if (response.data.verificationToken) {
        setVerificationToken(response.data.verificationToken);
        showToast({ type: 'info', text1: 'Verification token ready', text2: 'Development token was filled in.' });
      } else {
        showToast({ type: 'success', text1: 'Verification sent', text2: response.data.message });
      }
      setResendSeconds(60);
    } catch {
      showToast({ type: 'error', text1: 'Unable to resend', text2: 'Please try again in a minute.' });
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
        <View style={[styles.iconCircle, verified && styles.iconCircleSuccess]}>
          <Feather name={verified ? 'check-circle' : 'mail'} size={30} color={verified ? '#27AE60' : '#E94560'} />
        </View>
        <Text style={styles.title}>{verified ? 'Email Verified' : 'Verify Your Email'}</Text>
        <Text style={styles.subtitle}>
          {verified
            ? 'Your account is ready. Sign in with the password you created.'
            : 'Open the verification link we sent to your email. This proves the address belongs to you.'}
        </Text>

        {!verified ? (
          <>
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

            <Text style={styles.label}>Verification token</Text>
            <TextInput
              value={verificationToken}
              onChangeText={setVerificationToken}
              autoCapitalize="none"
              editable={!loading}
              placeholder="Paste token if the email link did not open"
              placeholderTextColor="#ADB5BD"
              style={[styles.input, styles.tokenInput]}
              multiline
            />

            <TouchableOpacity
              style={[styles.primaryButton, (loading || !canVerify) && styles.disabledButton]}
              onPress={() => verifyEmail()}
              disabled={loading || !canVerify}
            >
              {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Verify Email</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={resendVerification} disabled={loading || !canResend}>
              <Text style={[styles.secondaryText, (loading || !canResend) && styles.disabledText]}>
                {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Send a new verification link'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('Login')}>
            <Text style={styles.primaryText}>Back to Sign In</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FA' },
  content: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  iconCircle: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#E9456018', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  iconCircleSuccess: { backgroundColor: '#27AE6018' },
  title: { color: '#1A1A2E', fontSize: 28, fontWeight: '900' },
  subtitle: { color: '#6C757D', fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 22 },
  label: { color: '#1A1A2E', fontSize: 14, fontWeight: '900', marginTop: 14, marginBottom: 8 },
  input: { minHeight: 52, borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1A1A2E' },
  tokenInput: { minHeight: 86, textAlignVertical: 'top' },
  primaryButton: { marginTop: 22, height: 52, borderRadius: 14, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  disabledButton: { opacity: 0.55 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  secondaryButton: { alignItems: 'center', paddingVertical: 16 },
  secondaryText: { color: '#E94560', fontSize: 14, fontWeight: '900', textDecorationLine: 'underline' },
  disabledText: { color: '#ADB5BD' },
});
