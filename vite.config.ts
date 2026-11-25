// @ts-nocheck — this file runs in Node (the build), and the project carries no Node type definitions; the app's own
// code under src/ is checked as before.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** What a built site needs beyond the bundle (2026-11-17). None of it runs on the dev server.
 *  - Where the site lives (VITE_PUBLIC_URL) goes into the link-preview tags, so moving hosts is a build setting.
 *  - A Content-Security-Policy: the sign-in token is in localStorage, so a script from anywhere else must not run, and
 *    the page may only talk to the hosts it is written to use. The inline theme script is allowed by its hash.
 *  - The service worker's cache is named after the build, so each release clears the one before; the page carries the
 *    same mark, so the worker keeps only its own release's page. */
function site(env: Record<string, string>): Plugin {
  const origin = (value: string | undefined) => { try { return new URL(value ?? '').origin; } catch { return ''; } };
  const publicUrl = (env.VITE_PUBLIC_URL || 'https://ow-wl.github.io/NowRecommend/').replace(/\/*$/, '/');
  const api = origin(env.VITE_API_BASE_URL);
  // The commit, then the moment of the build: the same commit built again with other settings is another release to the
  // service worker too (its page and files differ), so the worker is replaced and the page's mark tells the two apart.
  const build = (env.VITE_RELEASE || '').toLowerCase().replace(/[^0-9a-z]/g, '').slice(0, 12) + Date.now().toString(36);
  let outDir = 'dist';
  return {
    name: 'nowrecommend-site',
    configResolved(config) { outDir = config.build.outDir; },
    transformIndexHtml: { order: 'post', handler(html, context) {
      const page = html.replaceAll('__PUBLIC_URL__', publicUrl);
      if (context.server) return page;  // the dev server injects scripts of its own; the policy is for what is shipped
      const inline = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
      const policy = [
        "default-src 'self'",
        `script-src 'self' ${inline.join(' ')}`.trim(),
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",  // React writes style attributes; the font's stylesheet
        "font-src 'self' data: https://cdn.jsdelivr.net",
        "img-src 'self' data: blob: https:",                          // covers and photos come from several picture hosts
        "media-src blob: https://*.apple.com https://*.mzstatic.com",  // the 30-second previews
        "frame-src https://embed.music.apple.com https://www.youtube-nocookie.com",  // Apple Music's and YouTube's players, opened from a song's details (src/fullPlay.ts)
        `connect-src 'self' ${api} https://itunes.apple.com https://api.open-meteo.com https://customer-api.open-meteo.com`.replace(/\s+/g, ' '),
        "manifest-src 'self'", "worker-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
      ].join('; ');
      // The build's mark: the service worker keeps only the page of its own build for offline use (public/sw.js).
      return page.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="nowrecommend-build" content="${build}" />`);
    } },
    closeBundle() {
      const worker = join(outDir, 'sw.js');
      if (existsSync(worker)) writeFileSync(worker, readFileSync(worker, 'utf8').replaceAll('__BUILD__', build));
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), site(loadEnv(mode, process.cwd(), 'VITE_'))],
  // Relative assets also work when the app lives under a repository path or any other folder.
  base: './',
  server: { port: 5173, strictPort: true },
}));
