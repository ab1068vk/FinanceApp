import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

type Props = {
  onUnlock: () => Promise<boolean>;
  onLogout: () => void;
};

export default function SecurityLockScreen({ onUnlock, onLogout }: Props) {
  const [loading, setLoading] = useState(false);

  const unlock = async () => {
    setLoading(true);
    try {
      await onUnlock();
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.logo}>
        <Feather name="lock" size={32} color="#FFFFFF" />
      </View>
      <Text style={styles.title}>FinanceApp Locked</Text>
      <Text style={styles.subtitle}>Authenticate again before viewing financial data.</Text>
      <TouchableOpacity
        style={[styles.primaryButton, loading && styles.disabledButton]}
        onPress={unlock}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Unlock FinanceApp"
      >
        {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Unlock</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={onLogout} accessibilityRole="button" accessibilityLabel="Sign out">
        <Text style={styles.secondaryText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A1A2E', padding: 28 },
  logo: { width: 78, height: 78, borderRadius: 39, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', textAlign: 'center' },
  subtitle: { color: '#DDE3EA', fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10, marginBottom: 24 },
  primaryButton: { width: '100%', maxWidth: 320, height: 52, borderRadius: 14, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  disabledButton: { opacity: 0.65 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  secondaryButton: { padding: 18 },
  secondaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', textDecorationLine: 'underline' },
});
