import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node', testTimeout: 10000,
    setupFiles: ['tests/unit/test-setup.ts'],
    coverage: {
      provider: 'v8', reporter: ['text', 'json-summary'],
      include: ['src/shared/{conversations,conversation-ai,book-extraction}.ts', 'src/workers/database/{conversations,book-extraction}.ts', 'src/main/{ai-transport,conversation-ai-service,conversation-ai-commands,book-extraction-commands,p1-command-policy}.ts', 'scripts/release-gate.mjs', 'src/shared/{document,structure-schema,profile,ai,ai-analysis,ai-extraction,ai-context,ai-reference,consistency,knowledge-scope,knowledge-source,manuscript-schema,manuscript,snapshots,archive,operation-errors}.ts', 'src/renderer/lib/{save-coordinator,manuscript-order}.ts', 'src/workers/database/{repository,structure,migration,schema,project-schema,learning-seed,learning-course-schema,snapshots,snapshot-export,archive-project,manuscript-import,ai-apply,knowledge-scope,assets,assets-knowledge,assets-search}.ts', 'src/main/{store-service,profile-service,profile-commands,avatar-selection,avatar-header,ai-commands,ai-settings,ai-service,archive-commands,project-archive,manuscript-commands,manuscript-docx,manuscript-text,manuscript-xml,manuscript-export,manuscript-files}.ts', 'scripts/{windows-file-retry,windows-icon,build-learning-course,build-textbook}.mjs'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
