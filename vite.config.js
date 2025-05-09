import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import yaml from '@rollup/plugin-yaml';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { createHtmlPlugin } from 'vite-plugin-html';

// Get the directory name equivalent in ESM
const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    monacoEditorPlugin({}),
    nodePolyfills(),
    yaml(),
    createHtmlPlugin({
      inject: {
        data: {
          injectAnalytics: true,
          analytics: {
            path: resolve(__dirname, 'src/analytics.html')
          }
        }
      }
    }),
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