import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'eslint.config.mjs'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      sourceType: 'commonjs',
    },
    rules: {
      // 레거시 코드베이스 점진 도입: 미사용 식별자는 오류 대신 경고
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
