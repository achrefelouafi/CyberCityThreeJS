// BODY 3 (8 s): first person. Driver's eye in the KX-11 cockpit (live instrument screens),
// a glance out of the side window, then the VR pitch.
window.CLIP = {
	duration: 8,
	warm: 1.5,
	setup(app, K) {
		app.setMode('drive'); // pilot camera without taking the stick: the autopilot keeps flying
		app.director.setDriveCam(2);
		app.ap.cruise = 64;
		app.director.shake = 1;
	},
	frame(app, t, K) {
		const d = app.director.drag;
		// look out of the left window and back (the cockpit cam damps back when released)
		const look = Math.sin(Math.PI * K.seg(t, 3.6, 6.2));
		d.active = look > 0.01;
		if (d.active) { d.yaw = 0.62 * K.ease.inOutSine(look); d.pitch = -0.05 * look; }
		app.ap.boost = t > 1.6 && t < 3.2 ? 1 : 0;
	},
	overlay(g, t, K) {
		const cap = (t0, t1, head, kick, y = 112) => {
			K.scrim(g, 960, y + 30, 900, 190, 0.5 * K.seg(t, t0, t0 + 0.15) * (1 - K.seg(t, t1 - 0.15, t1)));
			K.headline(g, head, { t0, t1, y, size: 96, from: 1.4 });
			K.kicker(g, kick, { t0: t0 + 0.15, t1, y: y + 93, size: 30, cursor: false });
		};
		cap(0.1, 3.9, 'JUMP IN THE COCKPIT', 'LIVE INSTRUMENT SCREENS · REAL INTERIOR');
		cap(4.1, 7.9, 'NOW IN VR', 'META QUEST 3 · WEBXR · GRAB THE HOLO YOKE');
		K.jpVertical(g, '操縦席', { t0: 0.3, t1: 3.9, x: 1830, y: 240, size: 50 });
		K.jpVertical(g, '仮想現実', { t0: 4.2, t1: 7.9, x: 1830, y: 240, size: 50, color: K.C.cyan });
		K.frame(g, { label: t < 4 ? 'COCKPIT' : 'VR READY', rec: true });
		K.glitch(g, (1 - K.seg(t, 0, 0.07)) * 0.7, 10);
		K.glitch(g, (1 - Math.abs(t - 4) / 0.06) * 0.5, 11);
		K.glitch(g, K.seg(t, 7.9, 8) * 0.8, 12);
	},
};
