// Streams every media clip into ONE canvas texture (4 x 4 tiles of 16:9), so the
// city uber-material and the hologram layer can show real footage with a single
// texture binding. Holo clips (square, black background) sit centred in their tile.
import { CanvasTexture, SRGBColorSpace, LinearFilter } from 'three/webgpu';

export const VIDEO_GRID = { cols: 4, rows: 4, w: 512, h: 288 };

export class VideoAtlas {
	constructor() {
		const { cols, rows, w, h } = VIDEO_GRID;
		this.canvas = document.createElement('canvas');
		this.canvas.width = cols * w;
		this.canvas.height = rows * h;
		this.ctx = this.canvas.getContext('2d', { alpha: false });
		this.ctx.fillStyle = '#000';
		this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
		this.texture = new CanvasTexture(this.canvas);
		this.texture.colorSpace = SRGBColorSpace;
		this.texture.generateMipmaps = false;
		this.texture.minFilter = LinearFilter;
		this.texture.magFilter = LinearFilter;
		this.clips = [];
		this.screens = []; // tile indices of 16:9 clips
		this.holos = []; // tile indices of square hologram clips
		this.acc = 0;
		this.credits = [];
	}

	async load(base = '/') {
		let meta;
		try {
			meta = await (await fetch(`${base}media/media.json`)).json();
		} catch {
			return this; // media is optional: procedural screens still work
		}
		const seen = new Set();
		meta.clips.forEach((c, i) => {
			const v = document.createElement('video');
			v.src = base + c.file;
			v.muted = true;
			v.loop = true;
			v.playsInline = true;
			v.preload = 'auto';
			v.crossOrigin = 'anonymous';
			v.play().catch(() => {});
			this.clips.push({ ...c, video: v, tile: i });
			(c.kind === 'holo' ? this.holos : this.screens).push(i);
			if (!seen.has(c.credit)) { seen.add(c.credit); this.credits.push(c.credit); }
		});
		// first frames
		await Promise.race([
			Promise.all(this.clips.map((c) => new Promise((r) => (c.video.readyState >= 2 ? r() : c.video.addEventListener('loadeddata', r, { once: true }))))),
			new Promise((r) => setTimeout(r, 4000)),
		]);
		this.draw();
		return this;
	}

	/** Restart playback after user interaction / tab visibility changes. */
	resume() { for (const c of this.clips) if (c.video.paused) c.video.play().catch(() => {}); }

	draw() {
		const { cols, w, h } = VIDEO_GRID;
		const g = this.ctx;
		for (const c of this.clips) {
			if (c.video.readyState < 2) continue;
			const x = (c.tile % cols) * w, y = Math.floor(c.tile / cols) * h;
			if (c.kind === 'holo') g.drawImage(c.video, x + (w - h) / 2, y, h, h);
			else g.drawImage(c.video, x, y, w, h);
		}
		this.texture.needsUpdate = true;
	}

	update(dt, fps = 30) {
		if (!this.clips.length) return;
		this.acc += dt;
		if (this.acc < 1 / fps) return;
		this.acc = 0;
		this.draw();
	}
}
