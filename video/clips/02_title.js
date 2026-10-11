// BODY 1 (5 s): title. High drone chase gliding down a canyon behind the Kestrel while the
// 新京都 / NEO//KYOTO lockup slams in.
window.CLIP = {
	duration: 5,
	warm: 2,
	setup(app, K) {
		K.lock();
		app.ap.cruise = 52;
		app.city.radius = 5;
		app.city.fill(app.camera);
	},
	camera(app, t, K) {
		const C = K.carPos(), k = K.ease.inOutSine(K.seg(t, 0, 5));
		const p = K.path(-K.mix(75, 40, k));
		p.y = C.y + K.mix(75, 30, k);
		const look = K.path(130);
		look.y = C.y + 4;
		K.setCam({ pos: p, look, fov: 60, roll: Math.sin(t * 0.7) * 0.025 });
	},
	overlay(g, t, K) {
		K.scrim(g, 960, 520, 820, 330, 0.55 * K.seg(t, 0, 0.3) * (1 - K.seg(t, 4.5, 4.9)));
		K.headline(g, '新京都', { t0: 0.15, t1: 4.85, y: 420, size: 220, family: K.FONT.jp, weight: 900, spacing: 30, from: 1.8, split: 34, outDur: 0.2 });
		K.headline(g, 'NEO//KYOTO', { t0: 0.55, t1: 4.85, y: 615, size: 92, spacing: 26, from: 1.3, color: K.C.cyan, color2: K.C.magenta, outDur: 0.2 });
		K.rule(g, { t0: 0.85, t1: 4.85, y: 690, w: 760 });
		K.kicker(g, 'AN INFINITE PROCEDURAL CITY', { t0: 1.05, t1: 4.85, y: 742, size: 32 });
		K.frame(g, { label: 'LIVE · WEBGPU', rec: true });
		K.glitch(g, (1 - K.seg(t, 0, 0.08)) * 0.7, 6);
		K.glitch(g, K.seg(t, 4.88, 5) * 0.8, 7);
	},
};
