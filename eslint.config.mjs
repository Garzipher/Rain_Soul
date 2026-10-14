import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['.artifacts/**', 'dist/**', 'release/**', 'coverage/**', 'node_modules/**', '.trae/**', 'docs/**', 'agent-skills-main/**', 'everything-claude-code/**'] },
  js.configs.recommended, ...tseslint.configs.recommended,
  { files: ['src/renderer/**/*.tsx'], plugins: { 'react-hooks': hooks }, rules: { 'react-hooks/rules-of-hooks': 'error' } },
  { files: ['tests/desktop/**/*.cjs', 'tests/fixtures/**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: {
    require: 'readonly', module: 'readonly', __dirname: 'readonly', process: 'readonly', Buffer: 'readonly', console: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly', window: 'readonly', document: 'readonly', localStorage: 'readonly', URL: 'readonly', crypto: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly', requestAnimationFrame: 'readonly', MutationObserver: 'readonly', performance: 'readonly',
  } }, rules: { '@typescript-eslint/no-require-imports': 'off' } },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
