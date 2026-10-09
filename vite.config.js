import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Dev-only endpoint: the app can POST a PNG of the canvas to /__shot?name=x and it
// is written to ./captures/x.png (used for automated look-dev and press stills).
const captures = {
	name: 'captures',
	configureServer(server) {
		server.middlewares.use('/__shot', (req, res) => {
			const url = new URL(req.url, 'http://x');
			const name = (url.searchParams.get('name') || `shot-${Date.now()}`).replace(/[^\w.-]/g, '_');
			const chunks = [];
			req.on('data', (c) => chunks.push(c));
			req.on('end', () => {
				const dir = resolve(import.meta.dirname, 'captures');
				mkdirSync(dir, { recursive: true });
				writeFileSync(resolve(dir, `${name}.png`), Buffer.concat(chunks));
				res.end('ok');
			});
		});
	},
};

export default defineConfig({
	plugins: [captures],
	build: { target: 'esnext', chunkSizeWarningLimit: 2000 },
	server: { port: 5173 },
});
