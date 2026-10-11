// BODY 2 (10 s): pursuit. Four director shots cut on the beat (chase, low, head-on, side
// track), each one teaching a feature; flight HUD bottom-left.
window.CLIP = {
	duration: 10,
	warm: 1.5,
	shots: [[-9, 'chase'], [2.5, 'low'], [5, 'front'], [7.5, 'side']],
	boosts: [[1.0, 2.4], [3.1, 4.7]],
	setup(app, K) {
		app.setMode('cinematic');
		app.ap.cruise = 68;
		app.director.shake = 1;
		this.cur = null;
		this.blur = app.post.u.motionBlur.value;
	},
	frame(app, t, K) {
		const s = [...this.shots].reverse().find(([t0]) => t >= t0)[1];
		// a cut has no valid previous frame: no motion blur on the first frame of a shot
		app.post.u.motionBlur.value = this.blur;
		if (s !== this.cur) {
			this.cur = s;
			app.director.mode = 'cinematic';
			app.director._start(s);
			app.post.u.motionBlur.value = 0;
		}
		app.director.shotLen = 1e9;
		// the director's follow cams lag ~v/7 m: ease off before the head-on shot so the car stays framed
		app.ap.cruise = t > 4.2 && t < 7.5 ? 36 : 68;
		app.ap.boost = this.boosts.some(([a, b]) => t >= a && t < b) ? 1 : 0;
	},
	overlay(g, t, K) {
		const boost = this.boosts.some(([a, b]) => t >= a && t < b);
		K.speedLines(g, boost ? 0.7 : 0);
		const cap = (t0, t1, head, kick) => {
			K.scrim(g, 960, 140, 900, 190, 0.5 * K.seg(t, t0, t0 + 0.15) * (1 - K.seg(t, t1 - 0.15, t1)));
			K.headline(g, head, { t0, t1, y: 112, size: 96, from: 1.4 });
			K.kicker(g, kick, { t0: t0 + 0.15, t1, y: 205, size: 30, cursor: false });
		};
		cap(0.1, 2.45, 'TAKE THE WHEEL', 'KEYBOARD · GAMEPAD · MOUSE-LOOK');
		cap(2.6, 4.95, 'THREAD THE CANYONS', 'THE AUTOPILOT DIVES UNDER EVERY SKYBRIDGE');
		cap(5.1, 7.45, '2,600 GPU CARS', 'TRAFFIC ON 4 LANE LEVELS · ZERO CPU COST');
		cap(7.6, 9.95, 'FULL TSL POST STACK', 'MOTION BLUR · BLOOM · SSR · ANAMORPHIC STREAKS');
		K.hud(g, { boost });
		K.frame(g, { label: 'PILOT CAM', rec: true });
		for (const c of [2.5, 5, 7.5]) K.flash(g, (1 - K.seg(t, c, c + 0.08)) * 0.25 * (t >= c ? 1 : 0), '#9ff0ff');
		K.glitch(g, (1 - K.seg(t, 0, 0.07)) * 0.7, 8);
		K.glitch(g, K.seg(t, 9.9, 10) * 0.8, 9);
	},
};
