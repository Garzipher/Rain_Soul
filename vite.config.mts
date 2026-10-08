import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer', base: './', plugins: [react()],
  build: {
    outDir: '../../dist/renderer', emptyOutDir: true,
    rolldownOptions: { output: { codeSplitting: { groups: [
      { name: 'editor', test: /node_modules[\\/](@tiptap|prosemirror|orderedmap|w3c-keyname)/ },
      { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
    ] } } },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
