import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.ts';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    crx({ manifest }),
    {
      name: 'bugcapsule-license-files',
      generateBundle() {
        // Vite's license report covers bundled JS. Include the project license
        // and the notice for Tailwind's CSS, which is emitted as a static asset.
        for (const [fileName, source] of [
          ['LICENSE.txt', 'LICENSE'],
          ['licenses/tailwindcss.txt', 'node_modules/tailwindcss/LICENSE'],
        ] as const) {
          this.emitFile({ type: 'asset', fileName, source: readFileSync(source, 'utf8') });
        }
      },
    },
  ],
  build: {
    target: 'chrome120',
    sourcemap: false,
    modulePreload: { polyfill: false },
    license: { fileName: 'licenses/dependencies.md' },
  },
});
