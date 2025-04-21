import { defineConfig } from 'vite';
import { resolve } from 'path';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import yaml from '@rollup/plugin-yaml';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { ViteFaviconsPlugin } from 'vite-plugin-favicon';

export default defineConfig({
  resolve: {
    alias: {
      jsunzip: resolve(__dirname, 'node_modules/jsbeeb/lib/jsunzip.js'),
      fs: resolve(__dirname, 'src/fake-fs.js'),
    },
  },
  plugins: [
    monacoEditorPlugin({}),
    nodePolyfills(),
    yaml(),
    ViteFaviconsPlugin('./assets/images/owlet.png'),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/jsbeeb/public/roms/**/*',
          dest: 'roms',
          globOptions: {
            ignore: ['**/*.txt', '**/*README*'],
          },
        },
        {
          src: 'node_modules/jsbeeb/public/sounds/**/*.wav',
          dest: 'sounds',
        },
      ],
    }),
  ],
  assetsInclude: ['**/*.ttf', '**/*.rom'],
  build: {
    outDir: 'dist',
    minify: true,
    sourcemap: true,
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      external: ['electron'],
      output: {
        manualChunks: {
          vendor: ['jquery', 'underscore'],
          monaco: ['monaco-editor'],
          jsbeeb: ['jsbeeb'],
        }
      }
    }
  },
  server: {
    port: 8080,
  },
  css: {
    devSourcemap: true,
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
      },
    },
  },
});