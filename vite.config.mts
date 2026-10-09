import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { textbookPlugin } from './scripts/textbook-vite-plugin.mjs';

export default defineConfig({
  root: 'src/renderer', base: './', plugins: [react(), textbookPlugin()],
  build: {
    outDir: '../../dist/renderer', emptyOutDir: true,
    rolldownOptions: { output: { codeSplitting: { groups: [
      { name: 'editor', test: /node_modules[\\/](@tiptap|prosemirror|orderedmap|w3c-keyname)/ },
      { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
      { name: 'textbook', test: /node_modules[\\/](react-markdown|remark-|rehype-|unified|highlight.js|lowlight|hast-|mdast-|micromark|unist-|vfile|property-information|parse-entities)/ },
    ] } } },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
