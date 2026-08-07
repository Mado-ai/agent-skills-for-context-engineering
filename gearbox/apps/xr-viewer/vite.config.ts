import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Everything inlines into one HTML file: the Artifact host blocks external hosts, and
// a single file is also the easiest thing to sideload onto a headset.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
    cssCodeSplit: false,
  },
});
