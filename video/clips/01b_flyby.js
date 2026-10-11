// HOOK 2/3 (2.00 - 3.25 s): camera parked in the canyon a beat ahead of the Kestrel; it
// screams past at ~330 km/h, the camera whips round to follow it down the street.
window.CLIP = {
	duration: 1.25,
	warm: 0.6,
	setup(app, K) {
		K.lock();
		app.ap.cruise = 95;
		app.ap.speed = 92;
		app.ap.boost = 1;
		app.director.shake = 0;
		this.anchor = null;
	},
	frame(app, t, K) {
		app.ap.boost = 1;
		app.post.u.motionBlur.value = 0.45;
		app.post.u.maxBlur.value = 0.05;
	},
	camera(app, t, K) {
		const C = K.carPos(), F = K.carFwd(), R = K.carRight();
		if (!this.anchor && t > -0.06) {
			// a parked spot ~0.75 s down the road, off to the right and just below the car's line
			const p = K.path(70), q = K.path(71);
			const f = q.clone().sub(p).setY(0).normalize();
			const r = K.v3().crossVectors(f, K.v3(0, 1, 0)).normalize();
			p.addScaledVector(r, 5.5).add(K.v3(0, -1.6, 0));
			this.anchor = p.add(app.city.origin); // absolute: survives origin rebasing
		}
		if (!this.anchor) {
			K.setCam({ pos: C.clone().addScaledVector(F, -10).add(K.v3(0, 2, 0)), look: C, fov: 60 });
			return;
		}
		const pos = this.anchor.clone().sub(app.city.origin);
		const look = C.clone().add(K.v3(0, 0.6, 0));
		const d = pos.distanceTo(C);
		// long lens while it approaches, snap wide as it passes
		const fov = K.clamp(24 + d * 0.55, 30, 84);
		K.setCam({ pos, look, fov, roll: -0.12 });
	},
	overlay(g, t, K) {
		K.scrim(g, 960, 880, 1000, 230, 0.55);
		K.headline(g, 'ZERO BUILDINGS', { t0: 0.0, t1: 1.25, y: 822, size: 104, from: 1.5, out: 'cut' });
		K.headline(g, 'MODELED BY HAND', { t0: 0.14, t1: 1.25, y: 938, size: 104, from: 1.6, out: 'cut', color: K.C.cyan, color2: K.C.magenta });
		K.frame(g, { label: 'LIVE · WEBGPU', rec: true });
		K.glitch(g, (1 - K.seg(t, 0, 0.07)) * 0.8, 2);
		K.glitch(g, K.seg(t, 1.17, 1.25) * 0.9, 3);
	},
};
