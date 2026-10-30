import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Writes /precache.json after a build: this build's version and every file the app needs to open
 * (the JS/CSS chunks, the page, icons). public/sw.js stores them on the phone, so the app opens in a
 * dead zone. Sounds, minigame voices and other large public files are left out.
 */
function precacheManifest(): Plugin {
  const version = Date.now().toString(36);
  let outDir = 'dist';
  return {
    name: 'cps-precache-manifest',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    // the service worker carries the build's version, so phones notice a new release
    closeBundle() {
      const sw = resolve(outDir, 'sw.js');
      if (existsSync(sw)) writeFileSync(sw, readFileSync(sw, 'utf8').replace("const BUILD = 'dev';", `const BUILD = '${version}';`));
    },
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter(f => /\.(js|css|html|svg|png|woff2?)$/.test(f) && !f.endsWith('.map'));
      const urls = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png', '/logo.svg', ...files.filter(f => f !== 'index.html').map(f => `/${f}`)];
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ version, urls: [...new Set(urls)] }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheManifest()],
});
