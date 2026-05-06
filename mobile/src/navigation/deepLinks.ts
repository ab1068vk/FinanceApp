export type FinanceDeepLink =
  | { type: 'verify-email'; token: string }
  | { type: 'reset-password'; token: string }
  | { type: 'verify-new-email'; token: string };

function cleanToken(value: string | null | undefined) {
  const token = String(value || '').trim();
  return token.length >= 32 ? token : null;
}

export function parseFinanceDeepLink(rawUrl: string): FinanceDeepLink | null {
  try {
    const url = new URL(rawUrl);
    const route = (url.hostname || url.pathname.split('/').filter(Boolean)[0] || '').replace(/^auth\/?/, '');
    const token = cleanToken(url.searchParams.get('token'))
      || cleanToken(url.pathname.split('/').filter(Boolean).pop());

    if (!token) return null;
    if (route === 'verify-email') return { type: 'verify-email', token };
    if (route === 'reset-password') return { type: 'reset-password', token };
    if (route === 'verify-new-email') return { type: 'verify-new-email', token };
    return null;
  } catch {
    return null;
  }
}

export function navigateFinanceDeepLink(navigation: { navigate: (...args: any[]) => void }, link: FinanceDeepLink) {
  if (link.type === 'verify-email') {
    navigation.navigate('Auth', { screen: 'VerifyEmail', params: { verificationToken: link.token } });
    return;
  }

  if (link.type === 'reset-password') {
    navigation.navigate('Auth', { screen: 'ForgotPassword', params: { resetToken: link.token } });
    return;
  }

  navigation.navigate('App', {
    screen: 'Profile',
    params: { screen: 'ProfileHome', params: { verifyNewEmailToken: link.token } },
  });
}
