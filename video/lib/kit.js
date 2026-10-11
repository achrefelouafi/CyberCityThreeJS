// Shared toolkit for clip scripts: easing, camera rigs on the autopilot path, and the
// NEO//KYOTO overlay language (Orbitron slams with an RGB split, Rajdhani type-on
// kickers, vertical Noto Sans JP, cyan -> magenta neon rules, glitch slices).
// Everything is a pure function of time, so any frame can be re-rendered on its own.
(() => {
	const K = (window.__K = {});

	// ------------------------------------------------------------------ palette
	K.C = {
		magenta: '#ff2fa0', cyan: '#18d6ff', ice: '#9ff0ff', violet: '#8a5cff', amber: '#ffb347',
		white: '#f4f8ff', ink: 'rgba(4,2,12,1)',
	};
	K.FONT = {
		head: '"Orbitron", sans-serif', ui: '"Rajdhani", sans-serif', jp: '"Noto Sans JP", "Yu Gothic", sans-serif', retro: '"Monoton", sans-serif',
	};

	// ------------------------------------------------------------------ math
	K.clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
	K.seg = (t, a, b) => K.clamp((t - a) / (b - a));
	K.mix = (a, b, k) => a + (b - a) * k;
	K.smooth = (k) => k * k * (3 - 2 * k);
	K.ease = {
		linear: (k) => k,
		inCubic: (k) => k * k * k,
		outCubic: (k) => 1 - (1 - k) ** 3,
		inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
		inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
		outExpo: (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k)),
		inExpo: (k) => (k <= 0 ? 0 : 2 ** (10 * k - 10)),
		inOutExpo: (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? 2 ** (20 * k - 10) / 2 : (2 - 2 ** (-20 * k + 10)) / 2),
		outBack: (k) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2,
		inQuart: (k) => k ** 4,
		outQuart: (k) => 1 - (1 - k) ** 4,
	};
	/**
	 * Opening split screen: the seed panel (00a) covers the left half until t0, then slides out
	 * to the left by t1 while the dive (00b) shifts its lens from the right half to the centre.
	 * master.mjs uses the same curve (inOutCubic) in its ffmpeg overlay expression.
	 */
	K.SPLIT = { t0: 3.5, t1: 4.0 };
	K.splitK = (t) => K.ease.inOutCubic(K.seg(t, K.SPLIT.t0, K.SPLIT.t1));
	K.hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
	K.frameNo = () => Math.round(K.t * K.fps);

	// ------------------------------------------------------------------ camera rigs
	const T = () => K.THREE;
	K.v3 = (x = 0, y = 0, z = 0) => new (T().Vector3)(x, y, z);
	/** Point on the autopilot's planned path, `ds` metres ahead of the car (render space). */
	K.path = (ds = 0, out = K.v3()) => {
		const { ap, city } = K.app;
		const s = ap.pathS + ds;
		ap.sample(s, out);
		out.y = ap.altitudeAt(s);
		return out.sub(city.origin);
	};
	K.carPos = (out = K.v3()) => out.copy(K.app.car.root.position);
	K.carFwd = (out = K.v3()) => out.copy(K.app.ap.forward).setY(0).normalize();
	K.carRight = (out = K.v3()) => out.crossVectors(K.carFwd(), K.v3(0, 1, 0)).normalize();
	/** Put the camera at `pos` looking at `look`, with roll (rad) and vertical fov (deg). */
	K.setCam = ({ pos, look, fov = 62, roll = 0, near = 0.25 }) => {
		const cam = K.app.camera;
		cam.position.copy(pos);
		cam.up.set(0, 1, 0);
		cam.lookAt(look);
		if (roll) cam.rotateZ(roll);
		if (cam.fov !== fov || cam.near !== near) { cam.fov = fov; cam.near = near; cam.updateProjectionMatrix(); }
	};
	K.lock = () => K.app.setMode('locked');
	/** Absolute (Blender-grid) block coordinates -> render-space metres. */
	K.block = (i, j, y = 0) => K.v3(i * K.app.layout.pitch, y, -j * K.app.layout.pitch).sub(K.app.city.origin);

	/** Move a Blender slider the way the control panel does (debounced regenerate), and wait for it. */
	K.setCityValue = async (name, v) => {
		const c = K.app.gui.controllersRecursive().find((c) => c.object === K.app.values && c.property === name);
		if (!c) throw new Error(`no slider ${name}`);
		c.setValue(v);
		await new Promise((r) => setTimeout(r, 260));
	};
	K.speed = () => Math.abs(K.app.ap.speed) * 3.6;

	// ------------------------------------------------------------------ assets
	K.images = {};
	K.loadAssets = async () => {
		const list = window.CLIP.assets ?? [];
		await Promise.all(list.map((n) => new Promise((res, rej) => {
			const im = new Image();
			im.onload = () => { K.images[n] = im; res(); };
			im.onerror = () => rej(new Error(`asset ${n}`));
			im.src = K.assetBase + n;
		})));
		await document.fonts.ready;
	};

	// ------------------------------------------------------------------ overlay language
	const layer = document.createElement('canvas');
	layer.width = 1920; layer.height = 1080;
	const L = layer.getContext('2d');
	const tmp = document.createElement('canvas');
	tmp.width = 1920; tmp.height = 1080;
	const TG = tmp.getContext('2d');

	const font = (g, weight, size, family, spacing = 0) => {
		g.font = `${weight} ${size}px ${family}`;
		g.letterSpacing = `${spacing}px`;
	};

	/** Soft dark pool behind text so it reads on top of bright neon. */
	K.scrim = (g, x, y, rx, ry, a = 0.55) => {
		g.save();
		g.translate(x, y);
		g.scale(rx, ry);
		const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
		gr.addColorStop(0, `rgba(3,0,10,${a})`);
		gr.addColorStop(0.55, `rgba(3,0,10,${a * 0.6})`);
		gr.addColorStop(1, 'rgba(3,0,10,0)');
		g.fillStyle = gr;
		g.fillRect(-1, -1, 2, 2);
		g.restore();
	};

	/**
	 * Headline slam: scales down onto the frame with a magenta/cyan split that snaps
	 * together, holds with a faint chromatic shiver and the odd glitch slice, then tears out.
	 * opts: x, y, size, t0, t1, align, color (glow), weight, spacing, lines gap, out ('tear'|'cut'|'fade')
	 */
	K.headline = (g, text, o) => {
		const t = K.t, t0 = o.t0 ?? 0, t1 = o.t1 ?? 99;
		if (t < t0 || t > t1) return;
		const u = t - t0, rem = t1 - t;
		const size = o.size ?? 120, x = o.x ?? K.W / 2, y = o.y ?? K.H / 2, align = o.align ?? 'center';
		const inK = K.ease.outExpo(K.seg(u, 0, o.inDur ?? 0.32));
		const outK = o.out === 'cut' ? 0 : 1 - K.seg(rem, 0, o.outDur ?? 0.16);
		const f = K.frameNo();
		const scale = K.mix(o.from ?? 1.4, 1, inK) * (1 + u * (o.drift ?? 0.025));
		const split = (o.split ?? 22) * (1 - inK) + 2.2 + outK * 40 + (K.hash(f * 3.1 + y) < 0.08 ? 10 : 0);
		const alpha = K.seg(u, 0, 0.05) * (o.out === 'fade' ? 1 - outK : 1);
		const lines = text.split('\n');
		const lh = size * (o.lineHeight ?? 1.08);
		const glow = o.color ?? K.C.magenta, glow2 = o.color2 ?? K.C.cyan;

		L.clearRect(0, 0, K.W, K.H);
		L.save();
		L.translate(x, y);
		L.scale(scale, scale * (1 - outK * 0.6));
		L.textAlign = align;
		L.textBaseline = 'middle';
		font(L, o.weight ?? 800, size, o.family ?? K.FONT.head, o.spacing ?? size * 0.06);
		const y0 = -((lines.length - 1) * lh) / 2;
		const draw = (dx, color, blur, shadow) => {
			L.fillStyle = color;
			L.shadowColor = shadow ?? color;
			L.shadowBlur = blur;
			lines.forEach((ln, i) => L.fillText(ln, dx, y0 + i * lh));
		};
		L.globalCompositeOperation = 'lighter';
		draw(-split, glow, 28);
		draw(split, glow2, 28);
		L.globalCompositeOperation = 'source-over';
		draw(0, o.fill ?? K.C.white, 14, glow);
		L.shadowBlur = 0;
		L.restore();

		// composite with horizontal slice displacement (entry + random glitches + exit tear)
		g.save();
		g.globalAlpha = alpha;
		const glitchy = (1 - inK) * 0.8 + outK + (K.hash(f * 7.7 + x) < 0.06 ? 0.5 : 0);
		if (glitchy < 0.02) g.drawImage(layer, 0, 0);
		else {
			const top = y - (lines.length * lh * scale) / 2 - size, bot = y + (lines.length * lh * scale) / 2 + size;
			g.drawImage(layer, 0, 0, K.W, Math.max(0, top), 0, 0, K.W, Math.max(0, top));
			let yy = Math.max(0, top);
			let k = 0;
			while (yy < Math.min(K.H, bot)) {
				const hgt = 6 + K.hash(f * 13 + k * 3.3) * 34;
				const off = (K.hash(f * 5 + k * 9.1) - 0.5) * 2 * glitchy * (K.hash(k + f) < 0.45 ? 90 : 8);
				g.drawImage(layer, 0, yy, K.W, hgt, off, yy, K.W, hgt);
				yy += hgt; k++;
			}
		}
		g.restore();
	};

	/** Small uppercase line that types itself on behind a block cursor. */
	K.kicker = (g, text, o) => {
		const t = K.t, t0 = o.t0 ?? 0, t1 = o.t1 ?? 99;
		if (t < t0 || t > t1) return;
		const u = t - t0;
		const n = Math.min(text.length, Math.floor(u * (o.cps ?? 55)));
		const fadeOut = 1 - K.seg(t, t1 - 0.12, t1);
		const size = o.size ?? 34;
		g.save();
		g.globalAlpha = fadeOut;
		g.textAlign = o.align ?? 'center';
		g.textBaseline = 'middle';
		font(g, 700, size, K.FONT.ui, o.spacing ?? size * 0.32);
		const shown = text.slice(0, n);
		const full = g.measureText(text).width;
		const x = o.x ?? K.W / 2, y = o.y ?? K.H / 2;
		const left = g.textAlign === 'center' ? x - full / 2 : g.textAlign === 'right' ? x - full : x;
		g.textAlign = 'left';
		g.fillStyle = o.color ?? K.C.ice;
		g.shadowColor = o.glow ?? K.C.cyan;
		g.shadowBlur = 12;
		g.fillText(shown, left, y);
		const w = g.measureText(shown).width;
		if (n < text.length || (Math.floor(u * 4) % 2 === 0 && o.cursor !== false)) {
			g.fillStyle = o.glow ?? K.C.cyan;
			g.fillRect(left + w + 6, y - size * 0.42, size * 0.5, size * 0.84);
		}
		g.restore();
	};

	/** Vertical Japanese caption down a screen edge (top to bottom), characters dropping in. */
	K.jpVertical = (g, text, o) => {
		const t = K.t, t0 = o.t0 ?? 0, t1 = o.t1 ?? 99;
		if (t < t0 || t > t1) return;
		const u = t - t0, size = o.size ?? 54, x = o.x ?? 1820, y = o.y ?? 200;
		const fadeOut = 1 - K.seg(t, t1 - 0.15, t1);
		g.save();
		g.textAlign = 'center';
		g.textBaseline = 'middle';
		font(g, 900, size, K.FONT.jp);
		[...text].forEach((ch, i) => {
			const k = K.ease.outExpo(K.seg(u, i * 0.045, i * 0.045 + 0.25));
			if (k <= 0) return;
			g.globalAlpha = k * fadeOut * (o.alpha ?? 1);
			g.fillStyle = o.color ?? K.C.magenta;
			g.shadowColor = o.color ?? K.C.magenta;
			g.shadowBlur = 24;
			g.fillText(ch, x, y + i * size * 1.08 - (1 - k) * 30);
			g.shadowBlur = 0;
			g.fillStyle = 'rgba(255,230,245,0.85)';
			g.fillText(ch, x, y + i * size * 1.08 - (1 - k) * 30);
		});
		g.restore();
	};

	/** Neon rule (cyan -> magenta) that draws itself on from the centre. */
	K.rule = (g, o) => {
		const t = K.t, t0 = o.t0 ?? 0, t1 = o.t1 ?? 99;
		if (t < t0 || t > t1) return;
		const k = K.ease.outExpo(K.seg(t, t0, t0 + (o.dur ?? 0.45))) * (1 - K.seg(t, t1 - 0.12, t1));
		const x = o.x ?? K.W / 2, y = o.y ?? K.H / 2, w = (o.w ?? 700) * k;
		g.save();
		const gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
		gr.addColorStop(0, 'rgba(24,214,255,0)');
		gr.addColorStop(0.25, K.C.cyan);
		gr.addColorStop(0.75, K.C.magenta);
		gr.addColorStop(1, 'rgba(255,47,160,0)');
		g.fillStyle = gr;
		g.shadowColor = K.C.cyan;
		g.shadowBlur = 18;
		g.fillRect(x - w / 2, y - (o.h ?? 4) / 2, w, o.h ?? 4);
		g.restore();
	};

	/** Thin viewfinder corners + the NEO//KYOTO bug. Keep it quiet: it frames, never competes. */
	K.frame = (g, o = {}) => {
		const a = o.alpha ?? 1;
		if (a <= 0) return;
		const m = 46, l = 54;
		g.save();
		g.globalAlpha = a * 0.85;
		g.strokeStyle = K.C.ice;
		g.lineWidth = 2.5;
		g.shadowColor = K.C.cyan;
		g.shadowBlur = 10;
		for (const [x, y, sx, sy] of [[m, m, 1, 1], [K.W - m, m, -1, 1], [m, K.H - m, 1, -1], [K.W - m, K.H - m, -1, -1]]) {
			g.beginPath();
			g.moveTo(x, y + sy * l); g.lineTo(x, y); g.lineTo(x + sx * l, y);
			g.stroke();
		}
		g.shadowBlur = 0;
		if (o.bug !== false) {
			g.textBaseline = 'middle';
			g.textAlign = 'left';
			font(g, 800, 22, K.FONT.head, 7);
			g.fillStyle = K.C.white;
			g.shadowColor = K.C.magenta;
			g.shadowBlur = 12;
			g.fillText('NEO//KYOTO', m + 24, m + 22);
			font(g, 900, 20, K.FONT.jp, 4);
			g.fillStyle = K.C.magenta;
			g.fillText('新京都', m + 24, m + 52);
		}
		if (o.label) {
			g.textAlign = 'right';
			font(g, 700, 22, K.FONT.ui, 6);
			g.fillStyle = K.C.ice;
			g.shadowColor = K.C.cyan;
			g.shadowBlur = 10;
			g.fillText(o.label, K.W - m - 24, m + 22);
			if (o.rec) {
				const on = Math.floor(K.t * 2) % 2 === 0;
				g.fillStyle = on ? '#ff3355' : 'rgba(255,51,85,0.25)';
				g.beginPath();
				g.arc(K.W - m - 24 - g.measureText(o.label).width - 22, m + 22, 7, 0, Math.PI * 2);
				g.fill();
			}
		}
		g.restore();
	};

	/** Data readout: label over a big Orbitron value (e.g. instance counts, km/h). */
	K.readout = (g, label, value, o) => {
		const t = K.t, t0 = o.t0 ?? 0, t1 = o.t1 ?? 99;
		if (t < t0 || t > t1) return;
		const k = K.ease.outExpo(K.seg(t, t0, t0 + 0.35)) * (1 - K.seg(t, t1 - 0.12, t1));
		g.save();
		g.globalAlpha = k;
		g.textAlign = o.align ?? 'left';
		g.textBaseline = 'alphabetic';
		const x = o.x, y = o.y + (1 - k) * 16;
		font(g, 700, o.labelSize ?? 24, K.FONT.ui, 6);
		g.fillStyle = o.labelColor ?? K.C.magenta;
		g.shadowColor = o.labelColor ?? K.C.magenta;
		g.shadowBlur = 10;
		g.fillText(label, x, y);
		font(g, 800, o.size ?? 64, K.FONT.head, 3);
		g.fillStyle = K.C.white;
		g.shadowColor = K.C.cyan;
		g.shadowBlur = 18;
		g.fillText(value, x, y + (o.size ?? 64) * 1.05);
		g.restore();
	};

	/** Flight HUD: big km/h with a segmented neon bar, altitude underneath. */
	K.hud = (g, o = {}) => {
		const a = o.alpha ?? 1;
		if (a <= 0) return;
		const x = o.x ?? 96, y = o.y ?? 930;
		const kmh = Math.round(o.kmh ?? K.speed()), alt = Math.round(o.alt ?? K.app.ap.pos.y);
		g.save();
		g.globalAlpha = a;
		g.textBaseline = 'alphabetic';
		g.textAlign = 'left';
		font(g, 800, 92, K.FONT.head, 2);
		g.fillStyle = K.C.white;
		g.shadowColor = K.C.cyan;
		g.shadowBlur = 20;
		const txt = String(kmh).padStart(3, '0');
		g.fillText(txt, x, y);
		const w = g.measureText(txt).width;
		font(g, 700, 30, K.FONT.ui, 6);
		g.fillStyle = K.C.ice;
		g.fillText('KM/H', x + w + 18, y - 4);
		// segmented bar: 24 cells up to 400 km/h, the hot end goes magenta
		const n = 24, lit = Math.round(K.clamp(kmh / 400) * n);
		for (let i = 0; i < n; i++) {
			g.fillStyle = i < lit ? (i > n * 0.7 ? K.C.magenta : K.C.cyan) : 'rgba(159,240,255,0.15)';
			g.shadowColor = g.fillStyle;
			g.shadowBlur = i < lit ? 10 : 0;
			g.fillRect(x + i * 17, y + 20, 12, 10);
		}
		g.shadowBlur = 0;
		font(g, 700, 26, K.FONT.ui, 6);
		g.fillStyle = K.C.magenta;
		g.fillText(`ALT ${String(alt).padStart(3, '0')} M`, x, y + 70);
		if (o.boost) {
			g.fillStyle = Math.floor(K.t * 8) % 2 ? K.C.magenta : K.C.white;
			g.fillText('▲ BOOST', x + 220, y + 70);
		}
		g.restore();
	};

	/** Count up from `a` to `b` between t0 and t0 + dur, formatted with separators. */
	K.count = (a, b, t0, dur = 0.8) => Math.round(K.mix(a, b, K.ease.outCubic(K.seg(K.t, t0, t0 + dur)))).toLocaleString('en-US');

	/** Additive full-frame flash (cuts on the beat). */
	K.flash = (g, a, color = '#ffffff') => {
		if (a <= 0.001) return;
		g.save();
		g.globalCompositeOperation = 'lighter';
		g.globalAlpha = K.clamp(a);
		g.fillStyle = color;
		g.fillRect(0, 0, K.W, K.H);
		g.restore();
	};

	/** Black dip (a = 0..1). */
	K.dip = (g, a) => {
		if (a <= 0.001) return;
		g.save();
		g.globalAlpha = K.clamp(a);
		g.fillStyle = '#030008';
		g.fillRect(0, 0, K.W, K.H);
		g.restore();
	};

	/** Tear the whole finished frame into displaced slices with an RGB fringe. */
	K.glitch = (g, amount, seed = 0) => {
		if (amount <= 0.01) return;
		const f = K.frameNo() + seed * 101;
		TG.setTransform(1, 0, 0, 1, 0, 0);
		TG.clearRect(0, 0, K.W, K.H);
		TG.drawImage(K.canvas, 0, 0, K.canvas.width, K.canvas.height, 0, 0, K.W, K.H);
		g.save();
		let y = 0, k = 0;
		while (y < K.H) {
			const h = 8 + K.hash(f * 3.7 + k) * 90;
			const hit = K.hash(f * 1.3 + k * 7.1) < 0.35 * amount + 0.1;
			const off = hit ? (K.hash(f + k * 2.9) - 0.5) * 260 * amount : 0;
			g.drawImage(tmp, 0, y, K.W, h, off, y, K.W, h);
			if (hit && amount > 0.3) {
				g.globalCompositeOperation = 'lighter';
				g.globalAlpha = 0.35 * amount;
				g.fillStyle = K.hash(k + f) < 0.5 ? K.C.magenta : K.C.cyan;
				g.fillRect(0, y, K.W, h);
				g.globalAlpha = 1;
				g.globalCompositeOperation = 'source-over';
			}
			y += h; k++;
		}
		g.restore();
	};

	/** Anime speed lines from a vanishing point (dive / boost accents). */
	K.speedLines = (g, amount, o = {}) => {
		if (amount <= 0.01) return;
		const cx = o.x ?? K.W / 2, cy = o.y ?? K.H / 2, f = K.frameNo();
		g.save();
		g.globalCompositeOperation = 'lighter';
		for (let i = 0; i < 90; i++) {
			const a = K.hash(i * 3.3 + f * 0.37) * Math.PI * 2;
			const r0 = 380 + K.hash(i + f * 1.7) * 500, len = 120 + K.hash(i * 9 + f) * 420;
			g.strokeStyle = i % 3 ? 'rgba(160,240,255,1)' : 'rgba(255,90,190,1)';
			g.globalAlpha = amount * (0.06 + K.hash(i * 5.1 + f) * 0.18);
			g.lineWidth = 1 + K.hash(i * 2.3) * 2.5;
			g.beginPath();
			g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
			g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
			g.stroke();
		}
		g.restore();
	};

	/** Horizontal scanline wash (CRT / hologram feel), for transitions. */
	K.scanlines = (g, a) => {
		if (a <= 0.01) return;
		g.save();
		g.globalAlpha = a;
		g.fillStyle = 'rgba(0,0,0,0.5)';
		for (let y = 0; y < K.H; y += 4) g.fillRect(0, y, K.W, 2);
		g.restore();
	};

	/** Draw an image to cover a rect (object-fit: cover), with zoom about a focus point. */
	K.cover = (g, im, x, y, w, h, zoom = 1, fx = 0.5, fy = 0.5) => {
		const s = Math.max(w / im.width, h / im.height) * zoom;
		const sw = w / s, sh = h / s;
		const sx = K.clamp(fx * im.width - sw / 2, 0, im.width - sw), sy = K.clamp(fy * im.height - sh / 2, 0, im.height - sh);
		g.drawImage(im, sx, sy, sw, sh, x, y, w, h);
	};
})();
