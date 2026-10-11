// HOOK 3/3 (3.25 - 5.00 s): the flex. Real Blender UI: the Seed slider ticks and the
// Geometry Nodes city regenerates (stop-motion beats), we punch into the viewport, and a
// neon wipe swaps Blender's 10 x 10-block preview for the browser render of the *same*
// camera on the *same* seed, where the city keeps going to the horizon.
// Screenshots: video/blender/capture_ui.py (see README in video/).
window.CLIP = {
	duration: 1.75,
	warm: 1,
	assets: ['blender/ui_01_seed21.png', 'blender/ui_02_seed33.png', 'blender/ui_03_seed58.png', 'blender/ui_04_seed90.png', 'blender/ui_00_seed7.png', 'blender/full_seed7.png'],
	// written by capture_ui.py: aerial CC_VidCam, and the camera frame's rect in the screenshots
	cam: { loc: [-205, -260, 330], target: [470, 420, 40], lens: 30, sensor: 36 },
	fullFrame: [137.2, 52.7, 1782.7, 978.3], // camera frame in full_seed7.png (maximised viewport)
	uiFrame: [753, 54, 1481, 463], // camera frame inside the GN-workspace viewport (ui_*.png)
	seedField: [1735, 390, 1860, 411], // Seed slider in the modifier panel (ui_*.png)
	setup(app, K) {
		K.lock();
		app.city.radius = 6;
		app.city.fill(app.camera);
		app.director.shake = 0;
	},
	camera(app, t, K) {
		// Blender Z-up -> three Y-up: (x, y, z) -> (x, z, -y)
		const o = app.city.origin, c = this.cam;
		const b2t = (v) => K.v3(v[0], v[2], -v[1]).sub(o);
		const vfov = (2 * Math.atan((c.sensor / 2 / c.lens) * (9 / 16)) * 180) / Math.PI;
		K.setCam({ pos: b2t(c.loc), look: b2t(c.target), fov: vfov, near: 1 });
	},
	overlay(g, t, K) {
		const I = K.images, E = K.ease;
		const ui = ['blender/ui_01_seed21.png', 'blender/ui_02_seed33.png', 'blender/ui_03_seed58.png', 'blender/ui_04_seed90.png', 'blender/ui_00_seed7.png'];
		const seeds = [21, 33, 58, 90, 7];
		const beat = 0.15; // stop-motion regeneration beats
		const zoom0 = ui.length * beat - 0.05, zoom1 = zoom0 + 0.3; // punch into the viewport
		const wipe0 = zoom1 + 0.05, wipe1 = wipe0 + 0.42;
		const lerpRect = (a, b, k) => a.map((v, i) => K.mix(v, b[i], k));

		// ---- Blender UI (full window -> camera frame of the viewport)
		if (t < zoom1 + 0.06) {
			const idx = Math.min(ui.length - 1, Math.floor(t / beat));
			const im = I[ui[idx]];
			const full = [0, 0, im.width, im.height];
			const zk = E.inOutExpo(K.seg(t, zoom0, zoom1));
			// slow push towards the viewport + slider while the seeds tick
			const push = lerpRect(full, [260, 30, 1900, 940], E.outCubic(K.seg(t, 0, zoom0)) * 0.3);
			const [x0, y0, x1, y1] = lerpRect(push, this.uiFrame, zk);
			g.fillStyle = '#000';
			g.fillRect(0, 0, 1920, 1080);
			// cover-fit the source rect into 16:9
			const sw = x1 - x0, sh = y1 - y0, s = Math.max(1920 / sw, 1080 / sh);
			const cw = 1920 / s, ch = 1080 / s, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
			g.drawImage(im, cx - cw / 2, cy - ch / 2, cw, ch, 0, 0, 1920, 1080);
			const map = (px, py) => [(px - (cx - cw / 2)) * s, (py - (cy - ch / 2)) * s];
			// beat flash on every regeneration
			K.flash(g, (1 - K.seg(t % beat, 0, 0.06)) * 0.18 * (t < zoom0 ? 1 : 0), '#9ff0ff');
			// neon box on the Seed slider + the value it just took
			if (t < zoom0 + 0.05) {
				const [a, b] = map(this.seedField[0], this.seedField[1]), [c, d] = map(this.seedField[2], this.seedField[3]);
				g.save();
				g.strokeStyle = K.C.magenta;
				g.shadowColor = K.C.magenta;
				g.shadowBlur = 18;
				g.lineWidth = 4;
				g.strokeRect(a - 10, b - 8, c - a + 20, d - b + 16);
				g.font = `800 34px ${K.FONT.head}`;
				g.letterSpacing = '4px';
				g.textAlign = 'right';
				g.textBaseline = 'middle';
				g.fillStyle = K.C.white;
				g.fillText(`SEED ${String(seeds[idx]).padStart(2, '0')}`, a - 30, (b + d) / 2);
				g.restore();
			}
		}
		// ---- maximised Blender viewport through the same camera, then the wipe to the browser
		if (t >= zoom1 - 0.04) {
			const im = I['blender/full_seed7.png'];
			const [x0, y0, x1, y1] = this.fullFrame;
			const wk = E.inOutCubic(K.seg(t, wipe0, wipe1));
			const wx = wk * 1920;
			g.save();
			g.globalAlpha = K.seg(t, zoom1 - 0.04, zoom1 + 0.04);
			g.beginPath();
			g.rect(wx, 0, 1920 - wx, 1080);
			g.clip();
			g.drawImage(im, x0, y0, x1 - x0, y1 - y0, 0, 0, 1920, 1080);
			g.restore();
			if (wk > 0 && wk < 1) {
				// the wipe line
				g.save();
				g.globalCompositeOperation = 'lighter';
				const gr = g.createLinearGradient(wx - 60, 0, wx + 8, 0);
				gr.addColorStop(0, 'rgba(24,214,255,0)');
				gr.addColorStop(0.85, 'rgba(24,214,255,0.55)');
				gr.addColorStop(1, 'rgba(255,255,255,1)');
				g.fillStyle = gr;
				g.fillRect(wx - 60, 0, 68, 1080);
				g.fillStyle = K.C.magenta;
				g.shadowColor = K.C.magenta;
				g.shadowBlur = 30;
				g.fillRect(wx + 2, 0, 5, 1080);
				g.restore();
			}
			// side labels while both halves are on screen
			const lab = (text, x, align, color, a) => {
				if (a <= 0) return;
				g.save();
				g.globalAlpha = a;
				g.font = `700 30px ${K.FONT.ui}`;
				g.letterSpacing = '8px';
				g.textAlign = align;
				g.textBaseline = 'middle';
				g.fillStyle = 'rgba(3,0,10,0.6)';
				const w = g.measureText(text).width;
				g.fillRect(align === 'left' ? x - 16 : x - w - 16, 1000 - 26, w + 32, 52);
				g.fillStyle = color;
				g.shadowColor = color;
				g.shadowBlur = 12;
				g.fillText(text, x, 1000);
				g.restore();
			};
			const both = K.seg(t, wipe0 + 0.05, wipe0 + 0.12) * (1 - K.seg(t, wipe1 + 0.15, wipe1 + 0.25));
			lab('BLENDER · 10×10 BLOCKS', Math.max(wx + 40, 1100), 'left', K.C.ice, both * (wx < 1500 ? 1 : 0));
			lab('BROWSER · ∞', Math.min(wx - 40, 800), 'right', K.C.magenta, both * (wx > 420 ? 1 : 0));
		}

		// ---- copy
		// over Blender's (empty) spreadsheet panel, so the viewport and the node tree stay clear
		if (t < zoom0) K.scrim(g, 330, 300, 420, 260, 0.6 * (1 - K.seg(t, zoom0 - 0.1, zoom0)));
		K.headline(g, 'BUILT IN\nBLENDER', { t0: 0.0, t1: zoom0 + 0.02, x: 64, y: 250, size: 96, align: 'left', from: 1.4, out: 'cut' });
		K.kicker(g, 'GEOMETRY NODES', { t0: 0.1, t1: zoom0 + 0.02, x: 68, y: 400, size: 30, align: 'left', cursor: false });
		K.kicker(g, '1,100+ NODES · 1 SEED', { t0: 0.22, t1: zoom0 + 0.02, x: 68, y: 446, size: 30, align: 'left', cursor: false, color: '#ffc6e6', glow: K.C.magenta });
		K.scrim(g, 960, 170, 900, 210, 0.5 * K.seg(t, wipe0, wipe0 + 0.1));
		K.headline(g, 'RUNS LIVE IN\nYOUR BROWSER', { t0: wipe0 + 0.08, t1: 1.75, y: 168, size: 100, from: 1.5, out: 'cut', color: K.C.cyan, color2: K.C.magenta });
		K.frame(g, { label: t < zoom1 ? null : 'LIVE · WEBGPU', rec: true });
		K.glitch(g, (1 - K.seg(t, 0, 0.06)) * 0.9, 4);
		K.glitch(g, (1 - Math.abs(t - zoom1) / 0.05) * 0.6, 5);
	},
};
