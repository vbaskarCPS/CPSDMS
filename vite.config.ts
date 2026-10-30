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
      // the planner (planner.html, src/planner) is its own app; the field app's phones don't keep it
      const files = Object.keys(bundle).filter(f => /\.(js|css|html|svg|png|woff2?)$/.test(f) && !f.endsWith('.map') && !/^planner\.html$|\/planner-[^/]*\.(js|css)$/.test(f));
      const urls = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png', '/logo.svg', ...files.filter(f => f !== 'index.html').map(f => `/${f}`)];
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ version, urls: [...new Set(urls)] }) });
    },
  };
}

/** Vijay Planner (src/planner) is a second page, planner.html, served at /vijayplanner/* (vercel.json
 *  rewrites it in production; this does the same for the dev server). Its own manifest makes it a
 *  separate home-screen app next to the field app. */
function plannerPage(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (req.url && /^\/vijayplanner(\/|$|\?)/.test(req.url) && !/\.\w+(\?|$)/.test(req.url)) req.url = '/planner.html';
    next();
  };
  return {
    name: 'cps-planner-page',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
}

export default defineConfig({
  plugins: [react(), precacheManifest(), plannerPage()],
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), planner: resolve(__dirname, 'planner.html') },
    },
  },
});
