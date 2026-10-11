// OPENING, full frame (0 - 4.6 s): the dive, under the seed panel. Until SPLIT.t0 the lens is
// shifted so the action is centred in the right half; as the panel slides out the lens
// glides back to centre, just as the camera pulls out of the dive behind the boosting car.
// The camera always rides the car's street centreline, so it can never clip a roof.
window.CLIP = {
	duration: 4.6,
	warm: 2,
	setup(app, K) {
		K.lock();
		app.ap.cruise = 78;
		app.city.radius = 5;
		app.city.fill(app.camera);
		app.director.shake = 0;
	},
	frame(app, t, K) {
		app.ap.boost = t > 3.2 ? 1 : 0.4;
		// the vertical plunge would smear the whole grid: keep the blur for the pull-out
		app.post.u.motionBlur.value = K.mix(0.08, 0.3, K.seg(t, 3.3, 3.9));
	},
	camera(app, t, K) {
		const E = K.ease;
		const k = E.inOutCubic(K.seg(t, 1.5, 3.95)); // 0 = top of the dive, 1 = chase position
		const C = K.carPos(), F = K.carFwd();
		// along the street: start 140 m ahead of the car, end 10.5 m behind it
		const ds = K.mix(140, -10.5, E.inOutSine(K.seg(t, 1.6, 4.0)));
		const p = K.path(ds);
		p.y = K.mix(420, C.y + 2.6, k);
		// orientation: straight down (road vertical in frame, slowly spinning) -> down the canyon
		const down = K.path(ds + 0.01);
		down.y = p.y - 300;
		const ahead = C.clone().addScaledVector(F, 8).add(K.v3(0, 0.9, 0));
		const look = down.clone().lerp(ahead, E.inOutCubic(K.seg(t, 2.9, 3.95)));
		look.addScaledVector(F, 2 * (1 - k)); // keeps lookAt stable while looking straight down
		const spin = (1 - E.outCubic(K.seg(t, 0, 3.6))) * 1.6;
		const fov = K.mix(66, 92, Math.sin(Math.PI * K.seg(t, 2.2, 4.4)));
		K.setCam({ pos: p, look, fov, roll: spin });
		// lens shift: action centred in the right half while the seed panel is up
		const d = 480 * (1 - K.splitK(t));
		app.camera.setViewOffset(1920, 1080, -d, 0, 1920, 1080);
	},
	overlay(g, t, K) {
		const cx = 1440 - 480 * K.splitK(t); // centre of the visible area
		K.speedLines(g, Math.sin(Math.PI * K.seg(t, 2.3, 4.6)) * 1.2, { x: cx });
		K.scrim(g, cx, 210, 470, 200, 0.55 * (1 - K.seg(t, 4.3, 4.6)));
		K.headline(g, 'THIS CITY', { t0: 0.15, t1: 4.6, x: cx, y: 160, size: 84, from: 1.6, out: 'cut' });
		K.headline(g, 'NEVER ENDS', { t0: 0.5, t1: 4.6, x: cx, y: 262, size: 100, from: 1.9, split: 36, out: 'cut', color: K.C.cyan, color2: K.C.magenta });
		K.kicker(g, 'NO TILES · NO LOOPS', { t0: 0.95, t1: 4.6, x: cx, y: 345, size: 28, cursor: false });
		K.jpVertical(g, '無限都市', { t0: 0.3, t1: 4.6, x: 1840, y: 260, size: 46 });
		K.frame(g, { label: 'LIVE · WEBGPU', rec: true, bug: t > K.SPLIT.t1 });
		// the panel's edge as it leaves: a hot sweep where the divider was
		const sk = K.seg(t, K.SPLIT.t0, K.SPLIT.t1 + 0.1);
		K.flash(g, Math.sin(Math.PI * sk) * 0.18, '#9ff0ff');
		K.glitch(g, K.seg(t, 4.5, 4.6) * 0.9, 1);
	},
};
