// OPENING, left half (960 x 1080, 0 - 4 s): ONE SLIDER. A NEW CITY. Six cities in ~3.3 s:
// the Seed slider (same input as Blender's modifier panel) jumps on every beat and the
// whole city regenerates with a new look. master.mjs composites this over 00b_dive and
// slides it out to the left between SPLIT.t0 and SPLIT.t1 (see kit.js).
window.CLIP = {
	duration: 4,
	size: [960, 1080],
	warm: 1.5,
	beats: [[-9, 1337, 'Synthwave'], [0.55, 4242, 'Akira Red'], [1.1, 90, 'Ghost Shell'], [1.65, 2077, 'Replicant Amber'], [2.2, 512, 'Synthwave'], [2.75, 7, 'Neon Noir']],
	setup(app, K) {
		K.lock();
		app.city.radius = 5;
		this.center = K.carPos().add(app.city.origin); // absolute
		this.cur = null;
	},
	async frame(app, t, K) {
		const b = [...this.beats].reverse().find(([t0]) => t >= t0);
		if (b !== this.cur) {
			this.cur = b;
			app.applyLook(b[2]);
			if (app.values.Seed !== b[1]) await K.setCityValue('Seed', b[1]);
		}
	},
	camera(app, t, K) {
		const c = this.center.clone().sub(app.city.origin);
		const a = 0.6 + t * 0.09;
		const pos = c.clone().add(K.v3(Math.cos(a) * 720, 720 - t * 10, Math.sin(a) * 720));
		K.setCam({ pos, look: c.clone().add(K.v3(0, 30, 0)), fov: 58, near: 1 });
	},
	overlay(g, t, K) {
		const b = [...this.beats].reverse().find(([t0]) => t >= t0);
		const n = this.beats.indexOf(b) + 1;
		const since = t - Math.max(0, b[0]);
		K.scrim(g, 480, 200, 520, 220, 0.6);
		K.headline(g, 'ONE SLIDER.', { t0: 0.0, t1: 4, y: 150, size: 80, from: 1.4, out: 'cut' });
		K.headline(g, 'A NEW CITY.', { t0: 0.3, t1: 4, y: 250, size: 80, from: 1.4, out: 'cut', color: K.C.cyan, color2: K.C.magenta });
		// seed readout, re-slams on every regeneration
		K.scrim(g, 480, 900, 420, 200, 0.6);
		K.readout(g, `SEED · CITY ${n}/6`, '', { t0: 0, t1: 4, x: 480, y: 822, align: 'center', labelSize: 28, labelColor: K.C.ice });
		K.headline(g, String(b[1]).padStart(4, '0'), { t0: Math.max(0, b[0]) + 0.01, t1: 4, y: 905, size: 124, from: 1.3, split: 28, inDur: 0.18, out: 'cut' });
		K.kicker(g, `LOOK · ${b[2].toUpperCase()}`, { t0: Math.max(0, b[0]) + 0.03, t1: 4, y: 995, size: 26, cursor: false, color: '#ffc6e6', glow: K.C.magenta });
		K.frame(g, { label: null });
		if (b[0] > 0) {
			K.glitch(g, (1 - K.seg(since, 0, 0.12)) * 0.9, 13 + n);
			K.flash(g, (1 - K.seg(since, 0, 0.09)) * 0.35, '#ff2fa0');
		}
		// the divider: hot neon edge on the panel's right side (it rides along when the panel slides out)
		g.save();
		const gr = g.createLinearGradient(0, 0, 0, K.H);
		gr.addColorStop(0, K.C.cyan);
		gr.addColorStop(0.5, K.C.magenta);
		gr.addColorStop(1, K.C.cyan);
		g.fillStyle = gr;
		g.shadowColor = K.C.magenta;
		g.shadowBlur = 24;
		g.fillRect(K.W - 6, 0, 6, K.H);
		g.restore();
		K.flash(g, (1 - K.seg(t, 0, 0.1)) * 0.4, '#ff2fa0');
	},
};
