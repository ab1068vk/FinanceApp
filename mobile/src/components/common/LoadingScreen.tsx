import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Feather from '@expo/vector-icons/Feather';
import { useTheme } from '../../theme';

export default function LoadingScreen() {
  const theme = useTheme();

  return (
    <LinearGradient colors={[theme.colors.primary, theme.colors.accent]} style={styles.container}>
      <View style={styles.logoCircle}>
        <Feather name="dollar-sign" size={34} color={theme.colors.warning} />
      </View>
      <Text style={styles.title}>FinanceApp</Text>
      <ActivityIndicator color={theme.colors.text.inverse} size="large" style={styles.spinner} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoCircle: { width: 82, height: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)' },
  title: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', marginTop: 16 },
  spinner: { marginTop: 24 },
});