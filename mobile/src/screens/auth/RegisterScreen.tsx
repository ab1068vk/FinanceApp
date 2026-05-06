import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { Controller, useForm, useWatch } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { StackScreenProps } from '@react-navigation/stack';
import { showToast } from '../../components/common/Toast';
import { AuthStackParamList } from '../../navigation';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { registerUser } from '../../store/slices/authSlice';
import { useTheme } from '../../theme';
import type { FeatherIconName } from '../../utils/icons';

type Props = StackScreenProps<AuthStackParamList, 'Register'>;
type RegisterForm = {
  full_name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const schema: yup.ObjectSchema<RegisterForm> = yup.object({
  full_name: yup.string().trim().required('Full name is required').min(2, 'Full name must be at least 2 characters').max(50, 'Full name must be 50 characters or less'),
  email: yup.string().trim().email('Enter a valid email address').required('Email is required'),
  password: yup.string().required('Password is required').matches(passwordRegex, 'Password does not meet the requirements'),
  confirmPassword: yup.string().required('Confirm your password').oneOf([yup.ref('password')], 'Passwords must match'),
});

function passwordChecks(password: string) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

export default function RegisterScreen({ navigation }: Props) {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const isLoading = useAppSelector((state) => state.auth.isLoading);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: yupResolver(schema),
    mode: 'onChange',
    defaultValues: { full_name: '', email: '', password: '', confirmPassword: '' },
  });

  const password = useWatch({ control, name: 'password' }) || '';
  const checks = useMemo(() => passwordChecks(password), [password]);
  const strength = Object.values(checks).filter(Boolean).length;

  const onSubmit = async ({ confirmPassword, ...values }: RegisterForm) => {
    try {
      const response = await dispatch(registerUser({ ...values, email: values.email.trim().toLowerCase() })).unwrap();
      showToast({
  type: 'success',
  text1: 'Account created',
  text2: 'You can now sign in.',
});

navigation.navigate('Login');
    } catch (error) {
      const message = typeof error === 'object' && error && 'message' in error
        ? String(error.message)
        : 'Unable to create your account. Please try again.';
      showToast({ type: 'error', text1: 'Registration failed', text2: message });
    }
  };

  const renderInput = (
    name: keyof RegisterForm,
    placeholder: string,
    icon: FeatherIconName,
    secure = false,
    visible = false,
    onToggle?: () => void
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field: { onBlur, onChange, value } }) => (
        <View style={styles.fieldBlock}>
          <View style={[styles.inputShell, errors[name] && styles.inputError]}>
            <Feather name={icon} size={20} color={theme.colors.accent} style={styles.inputIcon} />
            <TextInput
              value={value}
              onChangeText={(text) => onChange(name === 'email' ? text.trim().toLowerCase() : text)}
              onBlur={onBlur}
              editable={!isLoading}
              autoCapitalize="none"
              autoComplete={name === 'email' ? 'email' : secure ? 'password' : undefined}
              autoCorrect={name === 'email' || secure ? false : undefined}
              inputMode={name === 'email' ? 'email' : undefined}
              keyboardType={name === 'email' ? 'email-address' : 'default'}
              spellCheck={name === 'email' || secure ? false : undefined}
              secureTextEntry={secure && !visible}
              textContentType={name === 'email' ? 'emailAddress' : secure ? 'password' : undefined}
              placeholder={placeholder}
              placeholderTextColor={theme.colors.text.light}
              style={styles.input}
            />
            {secure && onToggle ? (
              <Pressable hitSlop={10} onPress={onToggle}>
                <Feather name={visible ? 'eye-off' : 'eye'} size={20} color={theme.colors.text.secondary} />
              </Pressable>
            ) : null}
          </View>
          {errors[name] ? <Text style={styles.errorText}>{errors[name]?.message}</Text> : null}
        </View>
      )}
    />
  );

  return (
    <LinearGradient colors={[theme.colors.primary, theme.colors.accent]} style={styles.gradient}>
      <View style={styles.glow} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} disabled={isLoading}>
            <Feather name="arrow-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.headerArea}>
            <Text style={styles.headerTitle}>Create Account</Text>
            <Text style={styles.headerSubtitle}>Join FinanceApp today</Text>
          </View>

          <View style={[styles.card, theme.shadows.medium]}>
            {renderInput('full_name', 'Full name', 'user')}
            {renderInput('email', 'Email address', 'mail')}
            {renderInput('password', 'Password', 'lock', true, showPassword, () => setShowPassword((value) => !value))}
            {renderInput('confirmPassword', 'Confirm password', 'shield', true, showConfirmPassword, () => setShowConfirmPassword((value) => !value))}

            <View style={styles.strengthRow}>
              {[0, 1, 2, 3].map((segment) => (
                <View
                  key={segment}
                  style={[
                    styles.strengthSegment,
                    {
                      backgroundColor: strength > segment
                        ? ['#E74C3C', '#F39C12', '#F1C40F', '#27AE60'][segment]
                        : '#DEE2E6',
                    },
                  ]}
                />
              ))}
            </View>

            <View style={styles.requirements}>
              <Requirement label="8+ characters" met={checks.length} />
              <Requirement label="Uppercase letter" met={checks.uppercase} />
              <Requirement label="Number" met={checks.number} />
              <Requirement label="Special character" met={checks.special} />
            </View>

            <TouchableOpacity style={[styles.primaryButton, isLoading && styles.disabledButton]} onPress={handleSubmit(onSubmit)} disabled={isLoading}>
              {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Create Account</Text>}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.secondaryLink} onPress={() => navigation.navigate('Login')} disabled={isLoading}>
            <Text style={styles.secondaryLinkText}>Already have an account? <Text style={styles.secondaryLinkStrong}>Sign In</Text></Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function Requirement({ label, met }: { label: string; met: boolean }) {
  return (
    <View style={styles.requirementRow}>
      <Feather name={met ? 'check-circle' : 'circle'} size={16} color={met ? '#27AE60' : '#ADB5BD'} />
      <Text style={[styles.requirementText, met && styles.requirementMet]}>{label}</Text>
    </View>
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
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32, paddingTop: 52 },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  headerArea: { minHeight: 150, justifyContent: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', letterSpacing: 0 },
  headerSubtitle: { color: '#D8DEE9', fontSize: 15, marginTop: 8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, shadowColor: '#000000' },
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
  strengthRow: { flexDirection: 'row', gap: 8, marginTop: 2, marginBottom: 16 },
  strengthSegment: { flex: 1, height: 6, borderRadius: 999 },
  requirements: { marginBottom: 22, gap: 8 },
  requirementRow: { flexDirection: 'row', alignItems: 'center' },
  requirementText: { color: '#6C757D', fontSize: 13, marginLeft: 8 },
  requirementMet: { color: '#1A1A2E', fontWeight: '700' },
  primaryButton: { height: 52, borderRadius: 12, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  disabledButton: { opacity: 0.72 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  secondaryLink: { alignItems: 'center', marginTop: 20, paddingVertical: 10 },
  secondaryLinkText: { color: '#FFFFFF', fontSize: 14, textDecorationLine: 'underline' },
  secondaryLinkStrong: { fontWeight: '800' },
});
