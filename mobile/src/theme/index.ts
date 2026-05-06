import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme, ViewStyle } from 'react-native';
import { loadAppSettings, saveAppSettings, ThemeMode } from '../services/appSettings';

export const colors = {
  primary: '#1A1A2E',
  secondary: '#16213E',
  accent: '#0F3460',
  highlight: '#E94560',
  success: '#27AE60',
  danger: '#E74C3C',
  warning: '#F39C12',
  background: '#F8F9FA',
  surface: '#FFFFFF',
  text: {
    primary: '#1A1A2E',
    secondary: '#6C757D',
    light: '#ADB5BD',
    inverse: '#FFFFFF',
  },
  border: '#DEE2E6',
} as const;

export const darkColors = {
  ...colors,
  background: '#101522',
  surface: '#171D2B',
  text: {
    primary: '#F8F9FA',
    secondary: '#C4CAD3',
    light: '#8F98A8',
    inverse: '#101522',
  },
  border: '#2B3445',
} as const;

export const typography = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 20,
  xl: 32,
  full: 999,
} as const;

export const shadows: Record<'small' | 'medium' | 'large', ViewStyle> = {
  small: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
    },
    android: { elevation: 2 },
    default: {},
  }),
  medium: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
    },
    android: { elevation: 5 },
    default: {},
  }),
  large: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.16,
      shadowRadius: 18,
    },
    android: { elevation: 10 },
    default: {},
  }),
};

export const theme = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
} as const;

type ThemeBase = Omit<typeof theme, 'colors'>;

export type Theme = ThemeBase & {
  colors: typeof colors | typeof darkColors;
  mode: ThemeMode;
  resolvedMode: 'Light' | 'Dark';
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<Theme>({
  ...theme,
  mode: 'System',
  resolvedMode: 'Light',
  setThemeMode: () => {},
});

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('System');

  useEffect(() => {
    loadAppSettings().then((settings) => setMode(settings.themeMode)).catch(() => {});
  }, []);

  const setThemeMode = (nextMode: ThemeMode) => {
    setMode(nextMode);
    loadAppSettings()
      .then((settings) => saveAppSettings({ ...settings, themeMode: nextMode }))
      .catch(() => {});
  };

  const resolvedMode = mode === 'System' ? (systemScheme === 'dark' ? 'Dark' : 'Light') : mode;
  const value = useMemo<Theme>(() => ({
    ...theme,
    colors: resolvedMode === 'Dark' ? darkColors : colors,
    mode,
    resolvedMode,
    setThemeMode,
  }), [mode, resolvedMode]);

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  return useContext(ThemeContext);
}
