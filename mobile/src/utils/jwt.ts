type JwtPayload = {
  exp?: unknown;
};

function decodeBase64Url(input: string): string | null {
  const decoder = (globalThis as { atob?: (value: string) => string }).atob;
  if (!decoder) return null;

  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  try {
    return decoder(padded);
  } catch {
    return null;
  }
}

export function getJwtExpiryMs(token: string | null | undefined): number | null {
  if (!token) return null;
  const payloadPart = token.split('.')[1];
  if (!payloadPart) return null;

  const decoded = decodeBase64Url(payloadPart);
  if (!decoded) return null;

  try {
    const payload = JSON.parse(decoded) as JwtPayload;
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function isJwtExpired(token: string | null | undefined, skewMs = 0): boolean {
  const expiryMs = getJwtExpiryMs(token);
  return Boolean(expiryMs && expiryMs <= Date.now() + skewMs);
}
