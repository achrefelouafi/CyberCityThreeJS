// BODY 4 (9 s): one slider, a new city. Locked aerial orbit; on every beat the Seed slider
// (the same input as Blender's modifier panel) jumps and the whole city regenerates,
// cycling the five looks. Ends back on seed 7.
window.CLIP = {
	duration: 9,
	warm: 1.5,
	beats: [[-9, 7, 'Neon Noir'], [1.25, 1337, 'Synthwave'], [2.5, 4242, 'Akira Red'], [3.75, 90, 'Ghost Shell'], [5.0, 2077, 'Replicant Amber'], [6.25, 7, 'Neon Noir']],
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
		const a = 0.6 + t * 0.07;
		const pos = c.clone().add(K.v3(Math.cos(a) * 720, 700 - t * 8, Math.sin(a) * 720));
		K.setCam({ pos, look: c.clone().add(K.v3(0, 40, 0)), fov: 50, near: 1 });
	},
	overlay(g, t, K) {
		const b = [...this.beats].reverse().find(([t0]) => t >= t0);
		const since = t - Math.max(0, b[0]);
		K.scrim(g, 420, 190, 520, 230, 0.55);
		K.headline(g, 'ONE SLIDER.', { t0: 0.1, t1: 8.9, x: 80, y: 140, size: 92, align: 'left', from: 1.3 });
		K.headline(g, 'A NEW CITY.', { t0: 0.45, t1: 8.9, x: 80, y: 252, size: 92, align: 'left', from: 1.3, color: K.C.cyan, color2: K.C.magenta });
		// seed readout, bottom right, re-slams on every beat
		K.scrim(g, 1560, 910, 460, 190, 0.55);
		K.headline(g, String(b[1]).padStart(4, '0'), { t0: Math.max(0, b[0]) + 0.02, t1: 9, x: 1830, y: 905, size: 130, align: 'right', from: 1.25, split: 30, inDur: 0.2, out: 'cut' });
		K.readout(g, 'SEED', '', { t0: 0.1, t1: 9, x: 1830, y: 812, align: 'right', labelSize: 30 });
		K.kicker(g, `LOOK · ${b[2].toUpperCase()}`, { t0: Math.max(0, b[0]) + 0.05, t1: 9, x: 1830, y: 1000, size: 28, align: 'right', cursor: false, color: '#ffc6e6', glow: K.C.magenta });
		K.frame(g, { label: 'GN · CC_CityGenerator', rec: true });
		if (b[0] > 0) {
			K.glitch(g, (1 - K.seg(since, 0, 0.14)) * 0.9, 13);
			K.flash(g, (1 - K.seg(since, 0, 0.1)) * 0.35, '#ff2fa0');
		}
		K.glitch(g, (1 - K.seg(t, 0, 0.07)) * 0.7, 14);
		K.glitch(g, K.seg(t, 8.9, 9) * 0.8, 15);
	},
};
