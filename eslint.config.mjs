import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'coverage/**', 'node_modules/**', '.trae/**', 'docs/**', 'agent-skills-main/**', 'everything-claude-code/**'] },
  js.configs.recommended, ...tseslint.configs.recommended,
  { files: ['src/renderer/**/*.tsx'], plugins: { 'react-hooks': hooks }, rules: { 'react-hooks/rules-of-hooks': 'error' } },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
