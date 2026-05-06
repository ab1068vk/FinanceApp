import React from 'react';
import ToastMessage, { BaseToast, ErrorToast, ToastConfig, ToastShowParams } from 'react-native-toast-message';

const shared = {
  text1Style: { fontSize: 15, fontWeight: '800' as const },
  text2Style: { fontSize: 13 },
};

export const toastConfig: ToastConfig = {
  success: (props) => <BaseToast {...props} {...shared} style={{ borderLeftColor: '#27AE60' }} />,
  error: (props) => <ErrorToast {...props} {...shared} style={{ borderLeftColor: '#E74C3C' }} />,
  warning: (props) => <BaseToast {...props} {...shared} style={{ borderLeftColor: '#F39C12' }} />,
  info: (props) => <BaseToast {...props} {...shared} style={{ borderLeftColor: '#0F3460' }} />,
};

export function AppToast() {
  return <ToastMessage config={toastConfig} position="top" visibilityTime={3000} autoHide />;
}

export function showToast(params: ToastShowParams) {
  ToastMessage.show({
    ...params,
    position: params.position ?? (params.type === 'success' ? 'bottom' : 'top'),
  });
}

export default ToastMessage;
