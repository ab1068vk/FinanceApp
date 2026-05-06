module.exports = {
  env: {
    commonjs: true,
    es2022: true,
    jest: true,
    node: true,
  },
  extends: ['eslint:recommended'],
  rules: {
    'no-console': 'warn',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
