const net = require('net');

function validIp(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.startsWith('::ffff:') ? value.slice(7) : value;
  return net.isIP(normalized) ? normalized : null;
}

function trustedProxySet() {
  return new Set(String(process.env.TRUSTED_PROXIES || '')
    .split(',')
    .map((value) => validIp(value.trim()))
    .filter(Boolean));
}

function forwardedFor(req, trustedProxies) {
  const remote = validIp(req.socket?.remoteAddress) || validIp(req.ip);
  if (!remote || !trustedProxies.has(remote)) return null;

  const chain = String(req.get?.('x-forwarded-for') || '')
    .split(',')
    .map((value) => validIp(value.trim()))
    .filter(Boolean);

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (!trustedProxies.has(chain[index])) return chain[index];
  }

  return chain[0] || null;
}

function clientIp(req) {
  const trustedProxies = trustedProxySet();
  return forwardedFor(req, trustedProxies) || validIp(req.ip) || validIp(req.socket?.remoteAddress) || null;
}

module.exports = {
  clientIp,
  validIp,
};
