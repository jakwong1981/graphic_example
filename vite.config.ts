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
        'donut-procedural-demo': './donut-procedural-demo.html',
        'model-demo': './model-demo.html',
        'image-to-3d-demo': './image-to-3d-demo.html',
        'car-uv-demo': './car-uv-demo.html',
        'flight-sim-demo': './flight-sim-demo.html',
        'tram-demo': './tram-demo.html',
        'zaku-demo': './zaku-demo.html'
      }
    }
  }
});
