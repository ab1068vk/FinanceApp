const certHash = process.env.EXPO_PUBLIC_API_CERT_HASH;
const isRequired = process.argv.includes('--required')
  || process.env.NODE_ENV === 'production'
  || process.env.EAS_BUILD_PROFILE === 'production';

if (!isRequired) {
  console.log('Production TLS pinning check skipped for non-production build.');
  process.exit(0);
}

if (!certHash || !certHash.trim()) {
  console.error('EXPO_PUBLIC_API_CERT_HASH is required for production builds.');
  process.exit(1);
}

if (!certHash.startsWith('sha256/')) {
  console.error('EXPO_PUBLIC_API_CERT_HASH must be a public key pin that starts with "sha256/".');
  process.exit(1);
}

console.log('Production TLS pinning configuration present.');
