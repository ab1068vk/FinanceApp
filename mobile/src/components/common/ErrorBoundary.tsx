import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { reportClientError } from '../../services/clientErrors';

type Props = { children: React.ReactNode; screen?: string; onReset?: () => void };
type State = { hasError: boolean };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('FinanceApp UI crash', error, info.componentStack);
    void reportClientError({
      message: error.message,
      stack: `${error.stack || ''}\n${info.componentStack || ''}`.trim(),
      screen: this.props.screen || 'unknown',
      platform: 'react-native',
    });
  }

  reset = () => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <View style={styles.iconCircle}><Feather name="alert-triangle" size={34} color="#E94560" /></View>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.subtitle}>FinanceApp hit an unexpected error. You can restart this part of the app and continue.</Text>
        <Pressable style={styles.button} onPress={this.reset}>
          <Text style={styles.buttonText}>Restart</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F8F9FA' },
  iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', marginBottom: 16 },
  title: { color: '#1A1A2E', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#6C757D', fontSize: 15, textAlign: 'center', marginTop: 8, lineHeight: 22 },
  button: { height: 48, borderRadius: 12, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E94560', marginTop: 24 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
