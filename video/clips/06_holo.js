// BODY 5 (8 s): holograms. (a) fly through a street-level torii tunnel; (b) drift up to a
// school of holo koi circling an intersection. Placement is found with the same hash
// src/world/HoloArt.js uses (pure function of the street grid), near the car's start.
window.CLIP = {
	duration: 8,
	warm: 1.5,
	async setup(app, K) {
		K.lock();
		app.ap.cruise = 40;
		app.city.radius = 5;
		const { hash2 } = await import('/src/city/blenderHash.js');
		const rnd = (i, j, k) => hash2((i * 73856093) ^ (k * 83492791), j * 19349663 + k * 7) / 4294967296;
		const P = app.layout.pitch, W = app.values['Street Width'];
		const ci = Math.round(app.ap.pos.x / P), cj = Math.round(-app.ap.pos.z / P);
		let torii = null, koi = null;
		for (let r = 1; r < 12 && !(torii && koi); r++) {
			for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
				if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
				const i = ci + di, j = cj + dj;
				for (const axis of [0, 1]) {
					if (torii || rnd(i, j, 51 + axis) >= 0.05 || rnd(i, j, 59 + axis) >= 0.6) continue;
					const n = 4 + Math.floor(rnd(i, j, 53 + axis) * 6);
					if (n >= 7) torii = { i, j, axis, n };
				}
				if (!koi && rnd(i, j, 31) < 0.06) koi = { i, j, alt: 45 + rnd(i, j, 33) * 140, radius: 22 + rnd(i, j, 34) * 40 };
			}
		}
		// absolute positions
		const node = (i, j, y = 0) => K.v3(i * P, y, -j * P);
		this.torii = torii && { a: node(torii.i, torii.j), d: torii.axis === 0 ? K.v3(1, 0, 0) : K.v3(0, 0, -1), h: W * 0.42 };
		this.koi = koi && { c: node(koi.i, koi.j, koi.alt), r: koi.radius };
		console.log('[06_holo]', JSON.stringify({ torii, koi }));
	},
	frame(app, t, K) {
		this.blur ??= app.post.u.motionBlur.value;
		app.post.u.motionBlur.value = t >= 4 && t < 4 + 1.5 / K.fps ? 0 : this.blur; // no smear on the cut
	},
	camera(app, t, K) {
		const o = app.city.origin;
		if (t < 4 && this.torii) {
			// down the street, through every gate, a little above head height of a gate's beam
			const { a, d, h } = this.torii;
			const k = K.ease.inOutSine(K.seg(t, -0.5, 4.2));
			const pos = a.clone().addScaledVector(d, K.mix(-35, app.layout.pitch - 8, k)).sub(o);
			pos.y = h;
			const look = pos.clone().addScaledVector(d, 40);
			look.y = h - 1.5;
			K.setCam({ pos, look, fov: 74, roll: Math.sin(t * 1.3) * 0.05 });
			return;
		}
		// koi: approach along the street into the intersection at the school's altitude, slowly orbit
		const { c, r } = this.koi;
		const k = K.ease.outCubic(K.seg(t, 4, 8));
		const dist = K.mix(r + 110, r + 22, k);
		const pos = c.clone().add(K.v3(-dist, 6, 0)).sub(o);
		K.setCam({ pos, look: c.clone().add(K.v3(0, 2, 0)).sub(o), fov: 60, roll: -0.04 });
	},
	overlay(g, t, K) {
		const cap = (t0, t1, head, kick) => {
			K.scrim(g, 960, 900, 980, 200, 0.55 * K.seg(t, t0, t0 + 0.15) * (1 - K.seg(t, t1 - 0.15, t1)));
			K.headline(g, head, { t0, t1, y: 880, size: 92, from: 1.4 });
			K.kicker(g, kick, { t0: t0 + 0.15, t1, y: 975, size: 30, cursor: false });
		};
		cap(0.1, 3.9, 'HOLOGRAM TORII', 'GEOMETRY NODES PIECES · ONE DRAW CALL EACH');
		cap(4.1, 7.9, 'HOLO KOI', 'SWIMMING IS A WAVE IN THE VERTEX SHADER');
		K.jpVertical(g, 'ホログラム', { t0: 0.3, t1: 7.9, x: 1830, y: 200, size: 46, color: K.C.cyan });
		K.frame(g, { label: 'LIVE · WEBGPU', rec: true });
		K.glitch(g, (1 - K.seg(t, 0, 0.07)) * 0.7, 16);
		K.glitch(g, (1 - Math.abs(t - 4) / 0.07) * 0.8, 17);
		K.glitch(g, K.seg(t, 7.9, 8) * 0.8, 18);
	},
};
