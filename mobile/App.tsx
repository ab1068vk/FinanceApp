import { NavigationContainer } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Provider } from 'react-redux';
import { Alert, AppState, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ErrorBoundary from './src/components/common/ErrorBoundary';
import LoadingScreen from './src/components/common/LoadingScreen';
import SecurityLockScreen from './src/components/common/SecurityLockScreen';
import { AppToast, showToast } from './src/components/common/Toast';
import { navigationRef, RootNavigator } from './src/navigation';
import { authActions, store, uiActions } from './src/store';
import { useAppDispatch, useAppSelector } from './src/store/hooks';
import { loadStoredAuth, logoutUser, refreshAccessToken } from './src/store/slices/authSlice';
import { API_BASE_URL } from './src/constants';
import { authenticateWithBiometrics, getBiometricPreference } from './src/services/biometrics';
import { reportClientError } from './src/services/clientErrors';
import { detectRootedOrJailbrokenDevice } from './src/services/deviceSecurity';
import { autoLockTimeoutMs, getAutoLockPreference } from './src/services/sessionLock';
import { getJwtExpiryMs, isJwtExpired } from './src/utils/jwt';
import { navigateFinanceDeepLink, parseFinanceDeepLink } from './src/navigation/deepLinks';
import { ThemeProvider } from './src/theme';

const linking: any = {
  prefixes: ['financeapp://auth', 'financeapp://'],
  config: {
    screens: {
      Auth: { screens: { Login: 'login', Register: 'register', ForgotPassword: 'reset-password', VerifyEmail: 'verify-email' } },
      App: { screens: { Profile: { screens: { ProfileHome: 'verify-new-email' } } } },
    },
  },
};

function optionalModule<T>(name: string): T | null {
  try {
    return require(name) as T;
  } catch {
    return null;
  }
}

function appVersion() {
  const Constants = optionalModule<{ expoConfig?: { version?: string } }>('expo-constants');
  return Constants?.expoConfig?.version || '1.0.0';
}

function compareVersions(left: string, right: string) {
  const a = left.split('.').map((part) => Number(part) || 0);
  const b = right.split('.').map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const delta = (a[i] || 0) - (b[i] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function AppBootstrap() {
  const dispatch = useAppDispatch();
  const isOnline = useAppSelector((state) => state.ui.isOnline);
  const accessToken = useAppSelector((state) => state.auth.accessToken);
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const [isRestoringAuth, setIsRestoringAuth] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [appIsInactive, setAppIsInactive] = useState(false);
  const [updateBannerVisible, setUpdateBannerVisible] = useState(false);
  const lastBackgroundAt = useRef<number | null>(null);
  const pendingInitialUrl = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const restoreTimeout = setTimeout(() => {
      if (mounted) {
        console.warn('Auth restore timed out; continuing to the app.');
        setIsRestoringAuth(false);
      }
    }, 4000);

    const restore = async () => {
      try {
        if (await getBiometricPreference()) {
          const unlocked = await authenticateWithBiometrics('Unlock FinanceApp');
          if (!unlocked) {
            dispatch(authActions.logout());
            return;
          }
        }
        await dispatch(loadStoredAuth()).unwrap();
      } finally {
        clearTimeout(restoreTimeout);
        if (mounted) {
          setIsRestoringAuth(false);
        }
      }
    };

    void restore();

    return () => {
      mounted = false;
      clearTimeout(restoreTimeout);
    };
  }, [dispatch]);

  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      pendingInitialUrl.current = url;
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const deepLink = parseFinanceDeepLink(url);
      if (!deepLink) return;
      if (navigationRef.isReady()) {
        navigateFinanceDeepLink(navigationRef, deepLink);
      } else {
        pendingInitialUrl.current = url;
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (isRestoringAuth || !pendingInitialUrl.current || !navigationRef.isReady()) return;
    const deepLink = parseFinanceDeepLink(pendingInitialUrl.current);
    pendingInitialUrl.current = null;
    if (deepLink) navigateFinanceDeepLink(navigationRef, deepLink);
  }, [isRestoringAuth]);

  useEffect(() => {
    const isProduction = process.env.NODE_ENV === 'production';
    const pointsToLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(API_BASE_URL);
    if (!API_BASE_URL || (isProduction && pointsToLocalhost)) {
      console.warn('FinanceApp API_BASE_URL is missing or points to localhost in production.', { API_BASE_URL, platform: Platform.OS });
    }
  }, []);

  useEffect(() => {
    const ScreenCapture = optionalModule<{
      preventScreenCaptureAsync?: () => Promise<void>;
      allowScreenCaptureAsync?: () => Promise<void>;
    }>('expo-screen-capture');
    if (!ScreenCapture) return;
    const action = isLocked ? ScreenCapture.allowScreenCaptureAsync : ScreenCapture.preventScreenCaptureAsync;
    action?.().catch((error) => {
      console.warn('Unable to update screen capture policy', error);
    });
  }, [isLocked]);

  useEffect(() => {
    void detectRootedOrJailbrokenDevice().then((suspicious) => {
      if (suspicious) {
        Alert.alert(
          'Security Notice',
          'This device appears to be rooted or jailbroken. For your security, some features may be restricted.'
        );
      }
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const health = await response.json();
        if (!mounted) return;
        const currentVersion = appVersion();
        const minVersion = String(health.min_app_version || '0.0.0');
        const latestVersion = String(health.version || currentVersion);
        const storeUrl = Platform.OS === 'ios'
          ? process.env.EXPO_PUBLIC_APP_STORE_URL
          : process.env.EXPO_PUBLIC_PLAY_STORE_URL;
        const openStore = () => {
          if (storeUrl) void Linking.openURL(storeUrl);
        };

        if (compareVersions(currentVersion, minVersion) < 0) {
          Alert.alert(
            'Required Update',
            'A required update is available. Please update the app to continue.',
            [{ text: 'Update', onPress: openStore }],
            { cancelable: false }
          );
          return;
        }

        setUpdateBannerVisible(compareVersions(currentVersion, latestVersion) < 0);
      } catch {
        // The app can continue offline; API calls already surface connection errors.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      dispatch(uiActions.setOnline(Boolean(state.isConnected && state.isInternetReachable !== false)));
    });

    void NetInfo.fetch().then((state) => {
      dispatch(uiActions.setOnline(Boolean(state.isConnected && state.isInternetReachable !== false)));
    });

    return unsubscribe;
  }, [dispatch]);

  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Unhandled promise rejection'));
      console.error('Unhandled promise rejection', reason);
      void reportClientError({
        message: reason.message,
        stack: reason.stack,
        screen: 'global',
        platform: 'react-native',
      });
    };

    globalThis.addEventListener?.('unhandledrejection', handler);
    return () => globalThis.removeEventListener?.('unhandledrejection', handler);
  }, []);

  useEffect(() => {
    if (!accessToken || !isAuthenticated) return undefined;
    const expiryMs = getJwtExpiryMs(accessToken);
    if (!expiryMs) return undefined;

    const refreshInMs = Math.max(expiryMs - Date.now() - 120000, 0);
    const timer = setTimeout(() => {
      dispatch(refreshAccessToken()).unwrap().catch(() => {
        showToast({ type: 'error', text1: 'Your session expired. Please log in.' });
      });
    }, refreshInMs);

    return () => clearTimeout(timer);
  }, [accessToken, dispatch, isAuthenticated]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        lastBackgroundAt.current = Date.now();
        setAppIsInactive(true);
        return;
      }

      if (nextState !== 'active') return;
      setAppIsInactive(false);
      if (!lastBackgroundAt.current || !isAuthenticated) return;

      void (async () => {
        const preference = await getAutoLockPreference();
        const timeoutMs = autoLockTimeoutMs(preference);
        const wasAwayMs = Date.now() - lastBackgroundAt.current!;
        lastBackgroundAt.current = null;
        if (timeoutMs !== null && wasAwayMs > timeoutMs) {
          setIsLocked(true);
        }

        if (isJwtExpired(accessToken)) {
          try {
            await dispatch(refreshAccessToken()).unwrap();
          } catch {
            showToast({ type: 'error', text1: 'Your session expired. Please log in.' });
          }
        }
      })();
    });

    return () => subscription.remove();
  }, [accessToken, dispatch, isAuthenticated]);

  const unlock = async () => {
    const unlocked = await authenticateWithBiometrics('Unlock FinanceApp');
    if (!unlocked) {
      showToast({ type: 'error', text1: 'Authentication required', text2: 'Please try again or sign out.' });
      return false;
    }
    setIsLocked(false);
    return true;
  };

  return (
    <ThemeProvider>
      <ErrorBoundary screen="Root">
        <StatusBar style="light" />
        {isRestoringAuth ? (
          <LoadingScreen />
        ) : (
          <NavigationContainer ref={navigationRef} linking={linking} onReady={() => {
            if (!pendingInitialUrl.current) return;
            const deepLink = parseFinanceDeepLink(pendingInitialUrl.current);
            pendingInitialUrl.current = null;
            if (deepLink) navigateFinanceDeepLink(navigationRef, deepLink);
          }}>
            {!isOnline ? <OfflineBanner /> : null}
            {updateBannerVisible ? <UpdateBanner onDismiss={() => setUpdateBannerVisible(false)} /> : null}
            {isLocked ? (
              <SecurityLockScreen
                onUnlock={unlock}
                onLogout={() => {
                  setIsLocked(false);
                  void dispatch(logoutUser()).unwrap().catch(() => dispatch(authActions.logout()));
                }}
              />
            ) : (
              <RootNavigator />
            )}
          </NavigationContainer>
        )}
        {appIsInactive ? <PrivacyOverlay /> : null}
        <AppToast />
      </ErrorBoundary>
    </ThemeProvider>
  );
}

function PrivacyOverlay() {
  return (
    <View style={styles.privacyOverlay} pointerEvents="none">
      <View style={styles.privacyLogo}><Text style={styles.privacyLogoText}>F</Text></View>
    </View>
  );
}

function UpdateBanner({ onDismiss }: { onDismiss: () => void }) {
  const openStore = () => {
    const storeUrl = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_APP_STORE_URL : process.env.EXPO_PUBLIC_PLAY_STORE_URL;
    if (storeUrl) void Linking.openURL(storeUrl);
  };

  return (
    <View style={styles.updateBanner}>
      <Text style={styles.updateText}>An update is available.</Text>
      <TouchableOpacity onPress={openStore} accessibilityRole="link" accessibilityLabel="Open app store update page">
        <Text style={styles.updateAction}>Update</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss update notice">
        <Text style={styles.updateAction}>Dismiss</Text>
      </TouchableOpacity>
    </View>
  );
}

function OfflineBanner() {
  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineText}>No internet connection</Text>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Provider store={store}>
        <AppBootstrap />
      </Provider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  offlineBanner: {
    backgroundColor: '#E74C3C',
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  updateBanner: {
    backgroundColor: '#0F3460',
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  updateText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', flex: 1 },
  updateAction: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', textDecorationLine: 'underline' },
  privacyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26,26,46,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  privacyLogo: { width: 82, height: 82, borderRadius: 24, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  privacyLogoText: { color: '#FFFFFF', fontSize: 42, fontWeight: '900' },
});
