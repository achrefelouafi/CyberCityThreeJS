// BODY 6 (9 s): scale. From the chase cam, the camera lets go of the car and rises straight
// up out of the canyon to 1.1 km, tilting down onto a city that runs to the horizon.
window.CLIP = {
	duration: 9,
	warm: 1.5,
	setup(app, K) {
		K.lock();
		app.ap.cruise = 60;
		app.city.radius = 6;
		app.city.fill(app.camera);
		this.base = null;
	},
	camera(app, t, K) {
		const o = app.city.origin, C = K.carPos(), F = K.carFwd();
		const chase = K.path(-10.5);
		chase.y = C.y + 2.7;
		const carLook = C.clone().addScaledVector(F, 8).add(K.v3(0, 0.9, 0));
		if (t < 0.8 || !this.base) {
			if (t >= 0.8 - 1e-6) this.base = { p: chase.clone().add(o), f: F.clone(), look: carLook.clone().add(o) };
			K.setCam({ pos: chase, look: carLook, fov: 66 });
			return;
		}
		// the camera lets go of the car: rise straight up above the street, then drift back
		const k = K.ease.inOutCubic(K.seg(t, 0.8, 7.6));
		const b = this.base.p.clone().sub(o);
		const pos = b.clone();
		pos.y = K.mix(b.y, 1100, k);
		pos.addScaledVector(this.base.f, -420 * K.ease.inOutSine(K.seg(t, 4.2, 9)));
		const far = b.clone().addScaledVector(this.base.f, 1500);
		far.y = 0;
		const look = this.base.look.clone().sub(o).lerp(far, K.ease.inOutCubic(K.seg(t, 0.9, 4.5)));
		K.setCam({ pos, look, fov: K.mix(66, 56, k), near: 1, roll: 0.06 * k });
	},
	overlay(g, t, K) {
		// freeze the live counters when they appear (streaming keeps changing them)
		if (t < 3.8 || !this.st) this.st = { ...K.app.city.stats };
		const st = this.st;
		K.scrim(g, 960, 170, 900, 200, 0.5 * K.seg(t, 1.2, 1.4));
		K.headline(g, 'IT KEEPS GOING.', { t0: 1.2, t1: 8.9, y: 150, size: 104, from: 1.4 });
		K.kicker(g, 'STREAMED IN CHUNKS · FLOAT64 ORIGIN REBASING', { t0: 1.5, t1: 8.9, y: 248, size: 30, cursor: false });
		K.scrim(g, 960, 905, 1100, 190, 0.55 * K.seg(t, 3.8, 4.1));
		K.readout(g, 'GN INSTANCES', K.count(0, st.instances, 3.8, 1.2), { t0: 3.8, t1: 8.9, x: 380, y: 880, align: 'center', labelColor: K.C.ice });
		K.readout(g, 'DRAW CALLS', K.count(0, st.drawCalls, 4.1, 0.8), { t0: 4.1, t1: 8.9, x: 960, y: 880, align: 'center', labelColor: K.C.ice });
		K.readout(g, 'HAND-MADE BUILDINGS', '0', { t0: 4.4, t1: 8.9, x: 1540, y: 880, align: 'center', labelColor: K.C.ice });
		K.frame(g, { label: 'LIVE · WEBGPU', rec: true });
		K.glitch(g, (1 - K.seg(t, 0, 0.07)) * 0.7, 19);
		K.glitch(g, K.seg(t, 8.9, 9) * 0.8, 20);
	},
};
