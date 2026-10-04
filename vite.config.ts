import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: './index.html',
        'combined-demo': './combined-demo.html',
        'vertex-demo': './vertex-demo.html',
        'fragment-demo': './fragment-demo.html',
        'donut-uv-demo': './donut-uv-demo.html',
        'donut-procedural-demo': './donut-procedural-demo.html'
      }
    }
  }
});
