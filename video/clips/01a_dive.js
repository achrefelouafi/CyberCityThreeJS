// HOOK 1/3 (0.00 - 2.00 s): free-fall from 480 m straight down onto the infinite grid,
// spinning, then pulling out of the dive right behind the Kestrel as it boosts down the
// canyon. The camera always rides the car's street centreline, so it can never clip a roof.
window.CLIP = {
	duration: 2.0,
	warm: 2,
	setup(app, K) {
		K.lock();
		app.ap.cruise = 78;
		app.city.radius = 5;
		app.city.fill(app.camera);
		app.director.shake = 0;
	},
	frame(app, t, K) {
		app.ap.boost = t > 1.2 ? 1 : 0.4;
		// the vertical plunge would smear the whole grid: keep the blur for the pull-out
		app.post.u.motionBlur.value = K.mix(0.08, 0.3, K.seg(t, 1.1, 1.6));
	},
	camera(app, t, K) {
		const E = K.ease;
		const k = E.inOutCubic(K.seg(t, 0.05, 1.6)); // 0 = top of the dive, 1 = chase position
		const C = K.carPos(), F = K.carFwd();
		// along the street: start 140 m ahead of the car, end 10.5 m behind it
		const ds = K.mix(140, -10.5, E.inOutSine(K.seg(t, 0.15, 1.6)));
		const p = K.path(ds);
		p.y = K.mix(400, C.y + 2.6, k);
		// orientation: look straight down (road vertical in frame, spinning out) -> look down the canyon
		const down = K.path(ds + 0.01);
		down.y = p.y - 300;
		const ahead = C.clone().addScaledVector(F, 8).add(K.v3(0, 0.9, 0));
		const look = down.clone().lerp(ahead, E.inOutCubic(K.seg(t, 0.7, 1.55)));
		// keep lookAt stable while looking straight down: feed a horizontal nudge along the road
		look.addScaledVector(F, 2 * (1 - k));
		const spin = (1 - E.outCubic(K.seg(t, 0, 1.3))) * 1.4;
		const fov = K.mix(70, 92, Math.sin(Math.PI * K.seg(t, 0.4, 1.7))) - 8 * K.seg(t, 1.6, 2);
		K.setCam({ pos: p, look, fov, roll: spin });
	},
	overlay(g, t, K) {
		K.speedLines(g, Math.sin(Math.PI * K.seg(t, 0.25, 1.75)) * 1.2);
		K.scrim(g, 960, 200, 900, 230, 0.5);
		K.headline(g, 'THIS CITY', { t0: 0.0, t1: 2.0, y: 150, size: 112, from: 1.8, out: 'cut' });
		K.headline(g, 'NEVER ENDS', { t0: 0.42, t1: 2.0, y: 278, size: 134, from: 2.2, split: 40, out: 'cut', color: K.C.cyan, color2: K.C.magenta });
		K.kicker(g, 'NO TILES · NO LOOPS · GENERATED AS YOU FLY', { t0: 0.95, t1: 2.0, y: 382, size: 30, cursor: false });
		K.jpVertical(g, '無限都市', { t0: 0.2, t1: 2.0, x: 1830, y: 230, size: 50 });
		K.frame(g, { label: 'LIVE · WEBGPU', rec: true, alpha: K.seg(t, 0, 0.15) });
		K.flash(g, (1 - K.seg(t, 0, 0.12)) * 0.35, '#ff2fa0');
		K.glitch(g, K.seg(t, 1.9, 2.0) * 0.9, 1);
	},
};
