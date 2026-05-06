import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Feather from '@expo/vector-icons/Feather';
import { Controller, useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import { AuthStackParamList } from '../../navigation';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { loginUser } from '../../store/slices/authSlice';
import { canUseBiometricAuth, getBiometricPreference, setBiometricPreference } from '../../services/biometrics';
import { registerPushNotificationsAfterLogin } from '../../services/pushNotifications';
import { useTheme } from '../../theme';

type Props = StackScreenProps<AuthStackParamList, 'Login'>;
type LoginForm = { email: string; password: string };

const schema: yup.ObjectSchema<LoginForm> = yup.object({
  email: yup.string().trim().email('Enter a valid email address').required('Email is required'),
  password: yup.string().required('Password is required'),
});

export default function LoginScreen({ navigation }: Props) {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const isLoading = useAppSelector((state) => state.auth.isLoading);
  const emailRef = useRef<TextInput>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: yupResolver(schema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    const timer = setTimeout(() => emailRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  const onSubmit = async (values: LoginForm) => {
    try {
      const result = await dispatch(loginUser({ ...values, email: values.email.trim().toLowerCase() })).unwrap();
      void registerPushNotificationsAfterLogin().catch(() => {
        showToast({ type: 'info', text1: 'Push notifications unavailable', text2: 'You can enable them later in settings.' });
      });

      if (result.user?.must_change_password) {
        showToast({
          type: 'warning',
          text1: 'Password reset required',
          text2: 'Please set a new password to continue.',
        });
      } else if ((await canUseBiometricAuth()) && !(await getBiometricPreference())) {
        Alert.alert('Enable biometric unlock?', 'Use Face ID or fingerprint to unlock FinanceApp when you reopen the app.', [
          { text: 'Not Now', style: 'cancel' },
          {
            text: 'Enable',
            onPress: () => {
              void setBiometricPreference(true).then(() => {
                showToast({ type: 'success', text1: 'Biometric unlock enabled' });
              }).catch(() => {
                showToast({ type: 'error', text1: 'Biometric setup failed' });
              });
            },
          },
        ]);
      }
    } catch (error) {
      const message = typeof error === 'object' && error && 'message' in error
        ? String(error.message)
        : 'Unable to sign in. Check your credentials and try again.';
      showToast({ type: 'error', text1: 'Sign in failed', text2: message });
    }
  };

  return (
    <LinearGradient colors={[theme.colors.primary, theme.colors.accent]} style={styles.gradient}>
      <View style={styles.glow} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.logoArea}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoCoin}>$</Text>
            </View>
            <Text style={styles.appName}>FinanceApp</Text>
            <Text style={styles.subtitle}>Your money, your control</Text>
          </View>

          <View style={[styles.card, theme.shadows.medium]}>
            <Text style={styles.cardTitle}>Welcome Back</Text>
            <Text style={styles.cardSubtitle}>Sign in to continue</Text>

            <Controller
              control={control}
              name="email"
              render={({ field: { onBlur, onChange, value } }) => (
                <View style={styles.fieldBlock}>
                  <View style={[styles.inputShell, errors.email && styles.inputError]}>
                    <Feather name="mail" size={20} color={theme.colors.accent} style={styles.inputIcon} />
                    <TextInput
                      ref={emailRef}
                      value={value}
                      onChangeText={(text) => onChange(text.trim().toLowerCase())}
                      onBlur={onBlur}
                      editable={!isLoading}
                      autoCapitalize="none"
                      autoComplete="email"
                      autoCorrect={false}
                      inputMode="email"
                      keyboardType="email-address"
                      spellCheck={false}
                      textContentType="emailAddress"
                      placeholder="Email address"
                      placeholderTextColor={theme.colors.text.light}
                      style={styles.input}
                    />
                  </View>
                  {errors.email ? <Text style={styles.errorText}>{errors.email.message}</Text> : null}
                </View>
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field: { onBlur, onChange, value } }) => (
                <View style={styles.fieldBlock}>
                  <View style={[styles.inputShell, errors.password && styles.inputError]}>
                    <Feather name="lock" size={20} color={theme.colors.accent} style={styles.inputIcon} />
                    <TextInput
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      editable={!isLoading}
                      autoCapitalize="none"
                      autoComplete="password"
                      secureTextEntry={!showPassword}
                      placeholder="Password"
                      placeholderTextColor={theme.colors.text.light}
                      style={styles.input}
                    />
                    <Pressable hitSlop={10} onPress={() => setShowPassword((visible) => !visible)}>
                      <Feather name={showPassword ? 'eye-off' : 'eye'} size={20} color={theme.colors.text.secondary} />
                    </Pressable>
                  </View>
                  {errors.password ? <Text style={styles.errorText}>{errors.password.message}</Text> : null}
                </View>
              )}
            />

            <TouchableOpacity style={styles.forgotLink} onPress={() => navigation.navigate('ForgotPassword')} disabled={isLoading}>
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.primaryButton, isLoading && styles.disabledButton]} onPress={handleSubmit(onSubmit)} disabled={isLoading}>
              {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Sign In</Text>}
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity style={styles.ghostButton} onPress={() => navigation.navigate('Register')} disabled={isLoading}>
              <Text style={styles.ghostButtonText}>Create Account</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.secondaryLink} onPress={() => navigation.navigate('Register')} disabled={isLoading}>
            <Text style={styles.secondaryLinkText}>New to FinanceApp? Create an account</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gradient: { flex: 1 },
  glow: {
    position: 'absolute',
    top: -90,
    alignSelf: 'center',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  logoArea: {
    minHeight: 270,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 38,
  },
  logoCircle: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: 'rgba(243,156,18,0.16)',
    borderWidth: 2,
    borderColor: '#F39C12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  logoCoin: { color: '#F39C12', fontSize: 42, fontWeight: '900' },
  appName: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', letterSpacing: 0 },
  subtitle: { color: '#D8DEE9', fontSize: 15, marginTop: 8 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000000',
  },
  cardTitle: { color: '#1A1A2E', fontSize: 24, fontWeight: '800' },
  cardSubtitle: { color: '#6C757D', fontSize: 14, marginTop: 6, marginBottom: 24 },
  fieldBlock: { marginBottom: 14 },
  inputShell: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#F5F5F5',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  inputError: { borderColor: '#E94560' },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, height: 48, color: '#1A1A2E', fontSize: 15 },
  errorText: { color: '#E74C3C', fontSize: 12, marginTop: 6, marginLeft: 4 },
  forgotLink: { alignSelf: 'flex-end', marginBottom: 20 },
  forgotText: { color: '#E94560', fontSize: 13, fontWeight: '700' },
  primaryButton: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#E94560',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: { opacity: 0.72 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 22 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#DEE2E6' },
  dividerText: { marginHorizontal: 14, color: '#ADB5BD', fontSize: 13, fontWeight: '700' },
  ghostButton: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButtonText: { color: '#1A1A2E', fontSize: 16, fontWeight: '800' },
  secondaryLink: { alignItems: 'center', marginTop: 20, paddingVertical: 10 },
  secondaryLinkText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
});
