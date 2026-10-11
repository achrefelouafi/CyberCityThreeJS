// Offline, frame-exact renderer for social clips.
//
//   node video/lib/render.mjs <clip> [--preview] [--fps 60] [--ss 1.5] [--from 0 --to 2] [--stills]
//
// Boots the app in headless Chrome (WebGPU) on a private Vite server (no HMR, so edits in
// the working tree can't reload the page mid-render), freezes time behind a virtual clock,
// and then steps the real app one frame at a time: the clip script places the camera and
// drives the scene, the full post stack renders into an offscreen target at ss x the output
// size, the page downsamples it, paints the 2D overlay (titles, HUD) and hands back a JPEG
// that is piped into ffmpeg. Output: video/out/<clip>.mp4 (1920x1080, H.264 High, yuv420p).
// GPU speed only changes how long a render takes, never what it looks like.

import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO = resolve(HERE, '..');
const ROOT = resolve(VIDEO, '..');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const clipName = argv.find((a) => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--')) ?? argv[0];
if (!clipName) { console.log('usage: node video/lib/render.mjs <clip> [--preview] [--from s] [--to s] [--stills]'); process.exit(1); }
const clipPath = [resolve(VIDEO, 'clips', `${clipName}.js`), resolve(clipName)].find(existsSync);
if (!clipPath) throw new Error(`no clip ${clipName}`);
const clipSrc = readFileSync(clipPath, 'utf8');
const meta = Function(`const window = {}; ${clipSrc}; return window.CLIP;`)(); // read duration/query without a browser

const preview = !!flag('preview', false);
const fps = +flag('fps', preview ? 30 : 60);
const ss = +flag('ss', preview ? 1 : (meta.ss ?? 1.5));
const size = meta.size ?? [1920, 1080]; // e.g. [960, 1080] for a half-screen panel
const outW = preview ? size[0] / 2 : size[0], outH = preview ? size[1] / 2 : size[1];
const from = +flag('from', 0), to = +flag('to', meta.duration);
const stills = flag('stills', false);
const name = basename(clipPath, '.js');
const outDir = resolve(VIDEO, 'out');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, `${name}${preview ? '.preview' : ''}.mp4`);

// ---------------------------------------------------------------- dev server (private, no HMR)
const server = await createServer({
	root: ROOT, configFile: resolve(ROOT, 'vite.config.js'), logLevel: 'error',
	server: { port: +flag('port', 5191), strictPort: false, hmr: false, watch: null },
});
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');

// ---------------------------------------------------------------- browser
const browser = await puppeteer.launch({
	executablePath: CHROME, headless: 'new', protocolTimeout: 1800000,
	args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu', `--window-size=${outW},${outH}`,
		'--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
	defaultViewport: { width: outW, height: outH },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { const t = m.text(); if ((/error/.test(m.type()) && !/404|403|GPU stall|favicon/.test(t)) || /^\[\d/.test(t)) console.log('[page]', t.slice(0, 400)); });
// virtual clock + seeded Math.random, installed before any app code runs
await page.evaluateOnNewDocument((seed) => {
	const real = performance.now.bind(performance);
	let v = null;
	performance.now = () => (v === null ? real() : v);
	window.__clock = { start() { v = real(); return v; }, set(ms) { v = ms; }, get() { return v; } };
	let s = seed >>> 0;
	Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}, meta.randomSeed ?? 1337);

const query = new URLSearchParams({ notitle: '', cinematic: '', noletterbox: '', dpr: '1', xr: '0', ...(meta.query ?? {}) });
const url = `${base}/?${query.toString().replace(/=(&|$)/g, '$1')}`;
console.log(`[${name}] ${outW}x${outH} @${fps} ss${ss} ${from}-${to}s  ${url}`);
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction(() => window.__app && document.getElementById('loader')?.classList.contains('done'), { timeout: 1800000, polling: 500 });
console.log(`[${name}] app ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

await page.addScriptTag({ content: readFileSync(resolve(HERE, 'kit.js'), 'utf8') });
await page.addScriptTag({ content: readFileSync(resolve(HERE, 'runtime.js'), 'utf8') });
await page.addScriptTag({ content: clipSrc });
await page.evaluate((o) => window.__vid.init(o), { w: outW, h: outH, ss, fps, from, size, assetBase: `${base}/video/assets/` });
console.log(`[${name}] warmed up in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// ---------------------------------------------------------------- frames -> ffmpeg
const n0 = Math.round(from * fps), n1 = Math.round(to * fps);
const ff = stills ? null : spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
	'-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'slow', '-crf', preview ? '22' : '15', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
	'-r', String(fps), '-movflags', '+faststart', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
const stillDir = resolve(outDir, `${name}_stills`);
if (stills) mkdirSync(stillDir, { recursive: true });
const every = stills ? Math.max(1, Math.round(fps * +(flag('every', 0.5)))) : 1;
const tStart = Date.now();
for (let i = n0; i < n1; i++) {
	const b64 = await page.evaluate((i) => window.__vid.frame(i), i);
	const buf = Buffer.from(b64, 'base64');
	if (stills) { if ((i - n0) % every === 0) writeFileSync(resolve(stillDir, `${String(i).padStart(4, '0')}.jpg`), buf); }
	else if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
	const done = i - n0 + 1;
	if (done % fps === 0 || i === n1 - 1) {
		const el = (Date.now() - tStart) / 1000;
		process.stdout.write(`[${name}] ${done}/${n1 - n0} frames · ${(el / done).toFixed(2)} s/frame · eta ${Math.round((el / done) * (n1 - n0 - done))} s\n`);
	}
}
if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('close', r)); }
await browser.close();
await server.close();
console.log(`[${name}] -> ${stills ? stillDir : outFile}`);
