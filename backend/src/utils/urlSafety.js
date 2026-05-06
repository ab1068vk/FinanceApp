const net = require('net');

function ipv4ToInt(value) {
  return value.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function ipv4InCidr(ip, cidrBase, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(cidrBase) & mask);
}

function isPrivateIp(hostname) {
  const normalized = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  const version = net.isIP(normalized);
  if (version === 4) {
    return ipv4InCidr(normalized, '10.0.0.0', 8)
      || ipv4InCidr(normalized, '127.0.0.0', 8)
      || ipv4InCidr(normalized, '169.254.0.0', 16)
      || ipv4InCidr(normalized, '172.16.0.0', 12)
      || ipv4InCidr(normalized, '192.168.0.0', 16)
      || normalized === '0.0.0.0';
  }
  if (version === 6) {
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:');
  }
  return false;
}

function isLocalHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost' || normalized.endsWith('.localhost') || isPrivateIp(normalized);
}

function assertSafeWebhookUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Webhook URL must be a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('Webhook URL must not include credentials');
  }
  if (isLocalHostname(url.hostname)) {
    throw new Error('Webhook URL cannot target localhost or private networks');
  }

  return url.toString();
}

module.exports = {
  assertSafeWebhookUrl,
  isLocalHostname,
  isPrivateIp,
};
