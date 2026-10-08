import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node',
    coverage: {
      provider: 'v8', reporter: ['text', 'json-summary'],
      include: ['src/shared/document.ts', 'src/shared/structure-schema.ts', 'src/renderer/lib/save-coordinator.ts', 'src/workers/database/{repository,structure,migration,schema,project-schema,learning-seed,learning-course-schema}.ts', 'src/main/store-service.ts', 'scripts/{windows-file-retry,windows-icon,build-learning-course}.mjs'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
