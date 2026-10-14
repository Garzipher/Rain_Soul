import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node', testTimeout: 10000,
    setupFiles: ['tests/unit/test-setup.ts'],
    coverage: {
      provider: 'v8', reporter: ['text', 'json-summary'],
      include: ['src/main/{render-content-ready,restricted-render-policy,restricted-html-encoding,web-html-encoding,render-resource-broker,render-deny-proxy,render-network-guard,render-error-observer,render-dom-capture,restricted-web-renderer,retrieval-model-selection}.ts', 'src/shared/source-capture.ts', 'scripts/{audited-desktop-build,prepare-bundled-retrieval-model,check-bundled-model-package,model-pack-policy,desktop-package-audit}.mjs', 'src/main/{public-web-address,public-web-transport,web-article,web-article-core,freeze-source,web-extraction-commands,retrieval-model-download,extraction-draft-store,extraction-draft-coordinator,retrieval-model-store,retrieval-commands,retrieval-client}.ts', 'src/shared/{source-document,text-diff,extraction-draft,retrieval,retrieval-model}.ts', 'src/workers/database/{source-document,source-schema,source-copy,snapshot-payload}.ts', 'src/workers/retrieval/{model,runtime,chunking,ranking,cache,engine,scheduler}.ts', 'src/renderer/components/{local-reference-panel,retrieval-model-panel}.tsx', 'src/shared/{conversations,conversation-ai,book-extraction,book-extraction-ai}.ts', 'src/workers/database/{conversations,book-extraction}.ts', 'src/main/{ai-transport,conversation-ai-service,conversation-ai-commands,book-extraction-commands,book-extraction-ai-commands,book-extraction-ai-service,p1-command-policy}.ts', 'scripts/release-gate.mjs', 'src/renderer/components/{book-extraction-ai-panel,book-extraction-workspace}.tsx', 'src/shared/{document,structure-schema,profile,ai,ai-analysis,ai-extraction,ai-context,ai-reference,consistency,knowledge-scope,knowledge-source,manuscript-schema,manuscript,snapshots,archive,operation-errors}.ts', 'src/renderer/lib/{knowledge-completion,knowledge-ghost-extension,save-coordinator,manuscript-order}.ts', 'src/workers/database/{repository,structure,migration,schema,project-schema,learning-seed,learning-course-schema,snapshots,snapshot-export,archive-project,manuscript-import,ai-apply,knowledge-scope,assets,assets-knowledge,assets-search}.ts', 'src/main/{store-service,profile-service,profile-commands,avatar-selection,avatar-header,ai-commands,ai-settings,ai-service,archive-commands,project-archive,manuscript-commands,manuscript-docx,manuscript-text,manuscript-xml,manuscript-export,manuscript-files}.ts', 'scripts/{windows-file-retry,windows-resource-retry,windows-icon,build-learning-course,build-textbook}.mjs'],
      // 受限渲染、内置资源及来源证据纳入门禁；运行库真实质量另外实测。
      exclude: ['src/workers/retrieval/worker.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
