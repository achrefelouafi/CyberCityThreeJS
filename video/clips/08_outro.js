// BODY 7 (6 s): outro. Slow glide over the canyon, logo lockup, stack + call to action,
// dip to black.
window.CLIP = {
	duration: 6,
	warm: 2,
	setup(app, K) {
		K.lock();
		app.ap.cruise = 40;
		app.city.radius = 5;
	},
	camera(app, t, K) {
		const C = K.carPos();
		const p = K.path(-60);
		p.y = C.y + 110 + t * 4;
		const look = K.path(220);
		look.y = C.y + 40;
		K.setCam({ pos: p, look, fov: 58, roll: -0.03 });
	},
	overlay(g, t, K) {
		K.scrim(g, 960, 520, 950, 420, 0.6 * K.seg(t, 0, 0.4));
		K.headline(g, '新京都', { t0: 0.1, t1: 6, y: 330, size: 170, family: K.FONT.jp, weight: 900, spacing: 24, from: 1.5, out: 'cut' });
		K.headline(g, 'NEO//KYOTO', { t0: 0.35, t1: 6, y: 488, size: 84, spacing: 24, from: 1.25, out: 'cut', color: K.C.cyan, color2: K.C.magenta });
		K.rule(g, { t0: 0.6, t1: 6, y: 556, w: 720 });
		K.kicker(g, 'BLENDER GEOMETRY NODES  →  THREE.JS WEBGPU', { t0: 0.8, t1: 6, y: 606, size: 30, cursor: false });
		K.kicker(g, 'PLAY IT IN YOUR BROWSER · VR ON QUEST 3', { t0: 1.6, t1: 6, y: 664, size: 30, color: '#ffc6e6', glow: K.C.magenta });
		K.headline(g, 'LINK BELOW ↓', { t0: 2.4, t1: 6, y: 790, size: 56, from: 1.2, out: 'cut' });
		K.frame(g, { bug: false });
		K.glitch(g, (1 - K.seg(t, 0, 0.07)) * 0.7, 21);
		K.dip(g, K.ease.inCubic(K.seg(t, 5.2, 6)));
	},
};
