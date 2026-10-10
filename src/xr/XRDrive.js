// WebXR drive mode (Meta Quest 3, or any immersive-vr headset).
//
// You sit in the Kestrel's cockpit at the driver's eye and fly it with the Touch
// controllers, or grab the holographic yoke with both grips and steer it like a
// real wheel. Three views: COCKPIT, CHASE (1:1, behind the car) and DIORAMA (you
// are 28x scale: the city becomes a miniature model with the car weaving through
// it). Haptics on impacts and boost, a holo dash HUD, a wrist computer on the
// left controller, and a comfort vignette that tightens in hard turns.
//
// Rendering: the session renders the scene directly (no post stack: none of it
// is stereo-aware, and the headset needs the frame budget). The shared `camera`
// that the city streamer, traffic, holograms and wires read is kept in sync with
// the headset pose, so everything streams around your head exactly as on desktop.

import {
	Group, PerspectiveCamera, Mesh, PlaneGeometry, SphereGeometry, TorusGeometry, CylinderGeometry, BoxGeometry,
	MeshBasicNodeMaterial, CanvasTexture, SRGBColorSpace, BackSide, FrontSide, DoubleSide, AdditiveBlending,
	Vector3, Euler, MathUtils, ACESFilmicToneMapping, ArrayCamera, RenderTarget,
} from 'three/webgpu';
import { uniform, float, vec3, positionLocal, normalize, dot, acos, smoothstep, max, texture, uv, sin, time, mix, fract, abs } from 'three/tsl';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { carUniforms } from '../vehicle/HoverCar.js';

export const XR_VIEWS = ['COCKPIT', 'CHASE', 'DIORAMA'];
const GIANT = 28; // diorama scale: you are 28x bigger than the city
const UP = new Vector3(0, 1, 0);
const _v = new Vector3(), _w = new Vector3(), _e = new Euler(), _s = new Vector3(), _q2 = new Vector3();

export const xrUniforms = {
	vignette: uniform(0), // 0..1 comfort tunnel
	fade: uniform(0), // 0..1 black (view switches, autopilot hand-off)
	yokeGlow: uniform(0),
};

/** Is this a standalone headset browser (Quest), where the XR backend should be the default? */
export const isHeadsetBrowser = () => /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);

/** Should the renderer boot on the WebGL backend so a WebXR session can start without reloading? */
export function wantsXRBackend(params) {
	if (params.has('xr')) return params.get('xr') !== '0';
	if (params.has('xremu')) return true;
	return isHeadsetBrowser() && typeof globalThis.XRGPUBinding === 'undefined';
}

export async function xrSupport() {
	if (!navigator.xr) return { ok: false, why: window.isSecureContext ? 'NO WEBXR IN THIS BROWSER' : 'WEBXR NEEDS HTTPS (npm run dev:xr)' };
	try {
		return (await navigator.xr.isSessionSupported('immersive-vr')) ? { ok: true } : { ok: false, why: 'NO VR HEADSET CONNECTED' };
	} catch (e) {
		return { ok: false, why: 'WEBXR BLOCKED: ' + e.message.toUpperCase() };
	}
}

// ---------------------------------------------------------------------------- holo panels
class HoloPanel {
	constructor(w, h, px = 1024) {
		this.canvas = document.createElement('canvas');
		this.canvas.width = px;
		this.canvas.height = Math.round((px * h) / w);
		this.g = this.canvas.getContext('2d');
		this.texture = new CanvasTexture(this.canvas);
		this.texture.colorSpace = SRGBColorSpace;
		const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
		const t = texture(this.texture, uv());
		// faint scanlines + flicker so it reads as a projection, not a sticker
		const scan = sin(uv().y.mul(this.canvas.height * 1.2).add(time.mul(4))).mul(0.12).add(0.88);
		m.colorNode = t.rgb.mul(scan).mul(1.6);
		m.opacityNode = t.a.mul(sin(time.mul(31)).mul(0.03).add(0.97));
		this.mesh = new Mesh(new PlaneGeometry(w, h), m);
		this.mesh.renderOrder = 1001; // above the fade sphere: the HUD stays readable while the world is dark
		this.mesh.frustumCulled = false;
	}
	commit() { this.texture.needsUpdate = true; }
}

function frame(g, W, H, col, alpha = 0.45) {
	g.clearRect(0, 0, W, H);
	const r = 26;
	g.beginPath();
	g.roundRect(6, 6, W - 12, H - 12, r);
	g.fillStyle = `rgba(6, 4, 18, ${alpha})`;
	g.fill();
	g.lineWidth = 4;
	g.strokeStyle = col;
	g.shadowColor = col;
	g.shadowBlur = 18;
	g.stroke();
	g.shadowBlur = 0;
}

const css = (c) => `rgb(${Math.round(Math.min(c.r, 1) * 255)}, ${Math.round(Math.min(c.g, 1) * 255)}, ${Math.round(Math.min(c.b, 1) * 255)})`;

// ---------------------------------------------------------------------------- the yoke
function buildYoke() {
	const m = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
	const p = positionLocal;
	const bands = smoothstep(0.35, 0.5, abs(fract(p.x.mul(40).add(time.mul(0.8))).sub(0.5))).mul(0.5).add(0.5);
	m.colorNode = carUniforms.neon.mul(mix(float(0.55), float(2.4), xrUniforms.yokeGlow)).mul(bands);
	const yoke = new Group();
	yoke.name = 'HoloYoke';
	const R = 0.17;
	// open-top racing yoke: lower arc + two grips + hub spokes
	const arc = new Mesh(new TorusGeometry(R, 0.011, 8, 64, Math.PI * 1.25), m);
	arc.rotation.z = Math.PI + (Math.PI - Math.PI * 1.25) / 2;
	yoke.add(arc);
	for (const s of [-1, 1]) {
		const grip = new Mesh(new CylinderGeometry(0.018, 0.018, 0.11, 12, 1, true), m);
		grip.position.set(s * R * 0.93, 0.03, 0);
		grip.rotation.z = s * 0.25;
		yoke.add(grip);
		const spoke = new Mesh(new BoxGeometry(R * 0.8, 0.008, 0.008), m);
		spoke.position.set(s * R * 0.45, -0.025, 0);
		spoke.rotation.z = s * -0.25;
		yoke.add(spoke);
	}
	const hub = new Mesh(new CylinderGeometry(0.035, 0.035, 0.012, 24), m);
	hub.rotation.x = Math.PI / 2;
	hub.position.y = -0.03;
	yoke.add(hub);
	yoke.traverse((o) => { o.frustumCulled = false; o.renderOrder = 15; });
	return yoke;
}

// ---------------------------------------------------------------------------- XR drive
export class XRDrive {
	constructor({ renderer, scene, car, toast }) {
		this.renderer = renderer;
		this.scene = scene;
		this.car = car;
		this.toast = toast ?? (() => {});
		this.presenting = false;
		this.view = 0;
		this.opts = { comfortBank: 0.3, vignette: 0.75, drawDistance: 2, framebufferScale: 1, foveation: 1, exposure: 1.25 };
		this.autopilot = false;
		this.onAutopilot = null; // (wantAutopilot) => void
		this.onSessionChange = null; // (presenting) => void

		// seat: rigidly mounted at the driver's eye, facing down the nose (+X in car space)
		this.seat = new Group();
		this.seat.position.copy(car.eye);
		this.seat.rotation.y = -Math.PI / 2;
		car.body.add(this.seat);
		// anchor: where your tracking space is in the world (seat / chase / diorama)
		this.anchor = new Group();
		this.anchor.name = 'XRAnchor';
		scene.add(this.anchor);
		// rig: recentre offset inside the anchor; the headset camera + controllers live here
		this.rig = new Group();
		this.anchor.add(this.rig);
		this.camera = new PerspectiveCamera(90, 1, 0.12, 3200);
		this.rig.add(this.camera);
		this.follow = { valid: false, yaw: 0, pos: new Vector3() };

		// comfort tunnel + fade: an inside-out sphere around the head
		const vm = new MeshBasicNodeMaterial({ transparent: true, side: BackSide, depthTest: false, depthWrite: false });
		const ang = acos(dot(normalize(positionLocal), vec3(0, 0, -1)));
		const r = mix(float(1.9), float(0.62), xrUniforms.vignette);
		vm.colorNode = vec3(0);
		vm.opacityNode = max(smoothstep(r.sub(0.35), r, ang).mul(xrUniforms.vignette.greaterThan(0.01).select(float(1), float(0))), xrUniforms.fade);
		this.tunnel = new Mesh(new SphereGeometry(0.3, 24, 16), vm);
		this.tunnel.renderOrder = 1000;
		this.tunnel.frustumCulled = false;
		this.camera.add(this.tunnel);

		// holographic yoke in front of the driver
		this.yoke = buildYoke();
		this.yoke.position.set(0, -0.36, -0.44);
		this.yoke.rotation.x = -0.35;
		this.yoke.visible = false;
		this.seat.add(this.yoke);
		this.grab = { active: false, z0: 0, angle: 0, steer: 0, lift: 0 };

		// dash HUD (scale-invariant: it lives in anchor space)
		this.dash = new HoloPanel(0.62, 0.2, 1024);
		this.anchor.add(this.dash.mesh);
		// wrist computer: left controller
		this.wrist = new HoloPanel(0.13, 0.09, 512);
		this.wrist.mesh.position.set(0, 0.035, 0.07);
		this.wrist.mesh.rotation.x = -1.0;

		// controllers
		this.hands = {}; // handedness -> { src, grip, ray, prev:[] }
		const factory = new XRControllerModelFactory();
		for (let i = 0; i < 2; i++) {
			const grip = renderer.xr.getControllerGrip(i);
			grip.add(factory.createControllerModel(grip));
			this.rig.add(grip);
			const ray = renderer.xr.getController(i);
			this.rig.add(ray);
			const slot = { grip, ray, src: null, prev: [], wasImpact: 0 };
			ray.addEventListener('connected', (e) => {
				slot.src = e.data;
				this.hands[e.data.handedness] = slot;
				if (e.data.handedness === 'left') grip.add(this.wrist.mesh);
			});
			ray.addEventListener('disconnected', () => {
				if (slot.src) delete this.hands[slot.src.handedness];
				slot.src = null;
			});
		}
		this._yDown = null;
		this._hudT = 0;
		this._blink = 0;
		this._lastImpact = 0;
		this._lastBoost = 0;
		this._msg = { text: '', t: 0 };

		renderer.xr.enabled = true;
		renderer.xr.setReferenceSpaceType('local'); // seated: origin = your head when the session starts
		renderer.xr.addEventListener('sessionstart', () => this._started());
		renderer.xr.addEventListener('sessionend', () => this._ended());
	}

	// ------------------------------------------------------------------ session
	async enter() {
		if (this.presenting) return;
		const xr = this.renderer.xr;
		xr.setFramebufferScaleFactor(this.opts.framebufferScale);
		xr.setFoveation(this.opts.foveation);
		const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'layers'] });
		await xr.setSession(session);
	}

	/**
	 * Build the headset's shader variants ahead of time (call during loading, before the
	 * animation loop runs). In a session every material needs a stereo variant (multiview,
	 * per-eye camera arrays, no motion-vector MRT), and three compiles those one after
	 * another — that was a long black screen after pressing ENTER VR. Here we compile
	 * against a stand-in for the XR target and camera; three caches node builds by material
	 * + camera layout and GL programs by source, so the session finds them all ready.
	 */
	async prewarm(view) {
		const r = this.renderer;
		if (!r.backend.isWebGLBackend) return;
		const multiview = !!(r.xr._useMultiviewIfPossible && r.hasFeature('OVR_multiview2'));
		const target = new RenderTarget(4, 4, { depth: multiview ? 2 : 1, multiview, colorSpace: r.outputColorSpace });
		const eyes = [0, 1].map(() => new PerspectiveCamera(140, 1, 0.12, 3200));
		const cam = new ArrayCamera(eyes);
		cam.isMultiViewCamera = multiview;
		for (const c of [cam, ...eyes]) {
			c.position.copy(view.position);
			c.quaternion.copy(view.quaternion);
			c.updateMatrixWorld(true);
			if (c !== cam) c.updateProjectionMatrix();
		}
		const prevTone = r.toneMapping;
		r.toneMapping = ACESFilmicToneMapping;
		this._stripMRT();
		// hidden things too (yoke, hologram characters waiting for a street corner): skinned
		// meshes bake their own bone buffer into the shader, so each needs its own variant
		const hidden = [];
		this.scene.traverse((o) => { if (!o.visible) { o.visible = true; hidden.push(o); } });
		// transparent double-sided materials are drawn as a back pass + a front pass, each its
		// own shader; compileAsync only builds the double-sided one (it restores material.side
		// before its deferred builds run). Compile the two passes explicitly, on throwaway
		// clones: the shader key is frozen when a render object is first created, and render
		// objects are cached per mesh, so the real meshes would just reuse the first build.
		const twoPass = [];
		this.scene.traverse((o) => {
			if (o.isMesh && !Array.isArray(o.material) && o.material.transparent && o.material.side === DoubleSide && !o.material.forceSinglePass) twoPass.push(o);
		});
		try {
			r.setOutputRenderTarget(target);
			await r.compileAsync(this.scene, cam);
			for (const side of [BackSide, FrontSide]) {
				for (const o of twoPass) {
					const c = o.clone(false);
					c.frustumCulled = false;
					o.material.side = side;
					await r.compileAsync(c, cam, this.scene);
					o.material.side = DoubleSide;
				}
			}
		} catch (e) {
			console.warn('XR prewarm', e);
		} finally {
			for (const o of twoPass) o.material.side = DoubleSide;
			r.setOutputRenderTarget(null);
			this._restoreMRT();
			for (const o of hidden) o.visible = false;
			r.toneMapping = prevTone;
		}
		this._prewarmTarget = target; // kept: its render objects hold the cached stereo builds
	}

	exit() { this.renderer.xr.getSession()?.end(); }

	toggle() { return this.presenting ? this.exit() : this.enter(); }

	_started() {
		this.presenting = true;
		this._prevTone = this.renderer.toneMapping;
		this._prevExposure = this.renderer.toneMappingExposure;
		this.renderer.toneMapping = ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = this._prevExposure * this.opts.exposure;
		this._stripMRT();
		this.follow.valid = false;
		this._placeHud();
		this.yoke.visible = true;
		this._recenterAt = 0.35; // once the first poses have arrived
		this._sessionT = 0;
		this.onSessionChange?.(true);
		// the stereo variants of every shader get built now: stay in the dark (HUD up) until they're ready
		this.warming = true;
		this.say('SPOOLING UP · COMPILING THE CITY FOR YOUR EYES', 60);
		this.renderer.compileAsync(this.scene, this.camera)
			.catch((e) => console.warn('XR precompile', e))
			.finally(() => {
				this.warming = false;
				this._blink = 1;
				this.say('WELCOME ABOARD · GRAB THE YOKE WITH BOTH GRIPS', 6);
				this.pulseAll(0.3, 60);
			});
	}

	/**
	 * Materials that add motion-vector outputs (mrtNode) would render *only* those outputs
	 * into the XR target — three uses the material MRT verbatim when the renderer has none —
	 * so they go black/missing in the headset. Park them for the session.
	 */
	_stripMRT() {
		this._mrt = new Map();
		this.scene.traverse((o) => {
			for (const m of [o.material].flat()) {
				if (m?.mrtNode && !this._mrt.has(m)) { this._mrt.set(m, m.mrtNode); m.mrtNode = null; m.needsUpdate = true; }
			}
		});
	}

	_restoreMRT() {
		for (const [m, node] of this._mrt ?? []) { m.mrtNode = node; m.needsUpdate = true; }
		this._mrt = null;
	}

	_ended() {
		this.presenting = false;
		this.warming = false;
		this._restoreMRT();
		this.renderer.toneMapping = this._prevTone;
		this.renderer.toneMappingExposure = this._prevExposure;
		this.yoke.visible = false;
		this.grab.active = false;
		xrUniforms.vignette.value = 0;
		xrUniforms.fade.value = 0;
		this.onSessionChange?.(false);
	}

	say(text, secs = 2.5) { this._msg.text = text; this._msg.t = secs; }

	/** Put the head back at the driver's eye, facing forward. */
	recenter() {
		const p = this.camera.position;
		const yaw = _e.setFromQuaternion(this.camera.quaternion, 'YXZ').y;
		this.rig.rotation.set(0, -yaw, 0);
		this.rig.position.copy(p).applyAxisAngle(UP, -yaw).negate();
		this.rig.updateMatrix();
	}

	cycleView() {
		this.view = (this.view + 1) % XR_VIEWS.length;
		this.follow.valid = false;
		this._placeHud();
		this._blink = 1;
		this.say(XR_VIEWS[this.view] + (this.view === 2 ? ' · 1:' + GIANT : ''));
	}

	/** Cockpit: a heads-up projection just past the windscreen. Outside: low, tilted up, clear of the car. */
	_placeHud() {
		const m = this.dash.mesh;
		if (this.view === 0) { m.position.set(0, -0.04, -0.95); m.rotation.x = -0.06; }
		else { m.position.set(0, -0.52, -0.95); m.rotation.x = -0.5; }
	}

	get inCockpit() { return this.presenting && this.view === 0; }

	// ------------------------------------------------------------------ input
	_pulse(slot, intensity, ms) {
		const h = slot?.src?.gamepad?.hapticActuators?.[0];
		if (h?.pulse) h.pulse(MathUtils.clamp(intensity, 0, 1), ms);
		else slot?.src?.gamepad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
	}

	pulseAll(intensity, ms) { for (const s of Object.values(this.hands)) this._pulse(s, intensity, ms); }

	/**
	 * Read the Touch controllers -> { throttle, steer, lift, boost, active }.
	 *   RT throttle · LT brake/reverse · left stick steer (+ throttle on Y) · right stick Y lift
	 *   both grips: grab the yoke (roll to steer, push/pull to dive/climb)
	 *   A boost · B view · X autopilot · Y recentre (hold to exit VR)
	 */
	read(dt) {
		const out = { throttle: 0, steer: 0, lift: 0, boost: false, active: false };
		if (!this.presenting) return out;
		const L = this.hands.left, R = this.hands.right;
		const btn = (s, i) => s?.src?.gamepad?.buttons[i];
		const val = (s, i) => btn(s, i)?.value ?? 0;
		const pressed = (s, i) => !!btn(s, i)?.pressed;
		const edge = (s, i) => { if (!s) return false; const p = pressed(s, i), was = s.prev[i]; s.prev[i] = p; return p && !was; };
		const stick = (s) => {
			const a = s?.src?.gamepad?.axes ?? [];
			const x = a.length >= 4 ? a[2] : a[0] ?? 0, y = a.length >= 4 ? a[3] : a[1] ?? 0;
			const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
			return [dz(x), dz(y)];
		};
		const [lx, ly] = stick(L), [, ry] = stick(R);
		out.throttle = MathUtils.clamp(val(R, 0) - val(L, 0) - ly, -1, 1);
		out.steer = lx;
		out.lift = -ry;
		out.boost = pressed(R, 4) || pressed(R, 3);

		// two-handed yoke
		const both = L && R && val(L, 1) > 0.55 && val(R, 1) > 0.55;
		if (both) {
			this.rig.updateMatrix();
			const pl = _v.copy(L.grip.position).applyMatrix4(this.rig.matrix);
			const pr = _w.copy(R.grip.position).applyMatrix4(this.rig.matrix);
			const angle = Math.atan2(pr.y - pl.y, pr.x - pl.x);
			const z = (pl.z + pr.z) / 2;
			if (!this.grab.active) {
				this.grab.active = true;
				this.grab.z0 = z;
				this.pulseAll(0.35, 40);
				if (this.autopilot) this.onAutopilot?.(false);
			}
			this.grab.angle = MathUtils.clamp(angle, -1.6, 1.6);
			this.grab.steer = MathUtils.clamp(-angle / 1.05, -1, 1);
			this.grab.lift = MathUtils.clamp((z - this.grab.z0) / 0.14, -1, 1);
			out.steer = this.grab.steer || out.steer;
			out.lift = this.grab.lift || out.lift;
		} else if (this.grab.active) {
			this.grab.active = false;
			this.pulseAll(0.15, 25);
		}

		// buttons
		if (edge(R, 5)) this.cycleView();
		if (edge(L, 4)) this.onAutopilot?.(!this.autopilot);
		// Y: tap = recentre, hold 1.2 s = leave VR (wall-clock, not the clamped frame dt)
		const now = performance.now() / 1000;
		if (pressed(L, 5)) {
			this._yDown ??= now;
			const held = now - this._yDown;
			if (held > 1.2 && !this._yFired) { this._yFired = true; this.pulseAll(0.8, 120); this.exit(); }
			else if (held > 0.5 && !this._yFired) this.say(`HOLD TO EXIT VR · ${Math.ceil((1.2 - held) * 10) / 10}s`, 0.3);
		} else {
			if (this._yDown != null && now - this._yDown < 0.5) { this.recenter(); this.say('RECENTERED'); this.pulseAll(0.2, 30); }
			this._yDown = null;
			this._yFired = false;
		}
		edge(R, 4); edge(L, 5); edge(R, 3);

		out.active = !!(out.throttle || out.steer || out.lift || out.boost || both);
		return out;
	}

	// ------------------------------------------------------------------ per frame
	/** Call after car.update(): places your tracking space, drives haptics/HUD, syncs the shared camera. */
	update(dt, fs, sharedCamera, info = {}) {
		if (!this.presenting) return;
		this._sessionT += dt;
		if (this._recenterAt && this._sessionT > this._recenterAt) { this.recenter(); this._recenterAt = 0; }
		const A = this.anchor, car = this.car;

		if (this.view === 0) {
			this.seat.updateMatrixWorld(true);
			this.seat.matrixWorld.decompose(A.position, A.quaternion, A.scale);
		} else {
			const giant = this.view === 2;
			const s = giant ? GIANT : 1;
			const C = car.root.position, yaw = car.root.rotation.y;
			const F = this.follow;
			const snap = !F.valid;
			if (snap) { F.yaw = yaw; F.valid = true; }
			// heading follows slowly in the diorama (the world must not spin around a giant)
			let d = yaw - F.yaw;
			d = Math.atan2(Math.sin(d), Math.cos(d));
			F.yaw += d * (1 - Math.exp(-(giant ? 0.8 : 5) * dt));
			_v.set(Math.cos(F.yaw), 0, -Math.sin(F.yaw));
			// diorama: the car is a ~20 cm toy about 1.6 giant-metres in front of / below you
			const back = giant ? 1.2 * s : 10 + Math.max(0, fs.speed) * 0.03;
			const up = giant ? 1.1 * s : 2.6;
			_w.copy(C).addScaledVector(_v, -back).addScaledVector(UP, up);
			// never park your head inside a tower: slide in towards the car until clear
			if (this.solidTest?.(_w)) {
				_s.copy(C).addScaledVector(UP, 1.5);
				let lo = 0, hi = 1;
				for (let k = 0; k < 7; k++) {
					const mid = (lo + hi) / 2;
					_q2.lerpVectors(_s, _w, mid);
					if (this.solidTest(_q2)) hi = mid; else lo = mid;
				}
				_w.lerpVectors(_s, _w, lo);
			}
			if (snap) F.pos.copy(_w);
			F.pos.lerp(_w, 1 - Math.exp(-(giant ? 3 : 9) * dt));
			A.position.copy(F.pos);
			A.quaternion.setFromEuler(_e.set(0, F.yaw - Math.PI / 2, 0));
			A.scale.setScalar(s);
		}
		A.updateMatrixWorld(true);

		// comfort: tunnel tightens with angular velocity and climb rate (cockpit + chase)
		const turn = Math.abs(fs.yawRate ?? 0) * MathUtils.clamp(Math.abs(fs.speed) / 30, 0, 1.5) + Math.abs(fs.altVel ?? 0) * 0.02;
		const vTarget = this.view === 2 ? 0 : MathUtils.clamp((turn - 0.25) * 0.9, 0, 1) * this.opts.vignette;
		xrUniforms.vignette.value = MathUtils.damp(xrUniforms.vignette.value, vTarget, 6, dt);
		this._blink = Math.max(0, this._blink - dt * 3);
		xrUniforms.fade.value = this.warming ? 1 : Math.max(this._blink > 0.5 ? 1 : this._blink * 2, info.fade ?? 0);
		// the tunnel sphere covers both eyes: don't blend it at all while it is fully transparent
		this.tunnel.visible = xrUniforms.vignette.value > 0.01 || xrUniforms.fade.value > 0;
		xrUniforms.yokeGlow.value = MathUtils.damp(xrUniforms.yokeGlow.value, this.grab.active ? 1 : 0, 10, dt);
		if (!this.grab.active) this.grab.angle = MathUtils.damp(this.grab.angle, -(info.steer ?? 0) * 0.9, 8, dt);
		this.yoke.rotation.z = this.grab.angle;

		// haptics: wall scrapes and boost kick-in
		const imp = fs.impact ?? 0;
		if (imp > this._lastImpact + 0.04) this.pulseAll(0.25 + imp * 0.75, 60 + imp * 120);
		this._lastImpact = imp;
		const b = fs.boost ?? 0;
		if (b > 0.5 && this._lastBoost <= 0.5) { this._pulse(this.hands.right, 0.6, 140); this._pulse(this.hands.left, 0.3, 90); }
		this._lastBoost = b;

		// HUDs at 15 Hz
		this._msg.t -= dt;
		this._hudT -= dt;
		if (this._hudT <= 0) { this._hudT = 1 / 15; this._drawHud(fs, info); }

		// the shared camera follows the head: streaming, LOD, billboards and traffic key off it
		this.camera.updateMatrixWorld(true);
		this.camera.matrixWorld.decompose(sharedCamera.position, sharedCamera.quaternion, _s);
		if (sharedCamera.fov !== 100 || sharedCamera.aspect !== 1) {
			sharedCamera.fov = 100;
			sharedCamera.aspect = 1;
			sharedCamera.updateProjectionMatrix();
		}
		sharedCamera.updateMatrixWorld(true);
	}

	render() { this.renderer.render(this.scene, this.camera); }

	rebase(delta) { this.follow.pos.sub(delta); }

	// ------------------------------------------------------------------ HUD drawing
	_drawHud(fs, info) {
		const neon = css(carUniforms.neon.value), pink = '#ff2fa0';
		const hit = (fs.impact ?? 0) > 0.15;
		// the canvases are only redrawn (and re-uploaded to the GPU) when what they show changes
		const speed = String(Math.round(Math.abs(fs.speed) * 3.6)).padStart(3, '0');
		const alt = String(Math.round(fs.alt)).padStart(3, '0');
		const hdg = ((90 - MathUtils.radToDeg(Math.atan2(-fs.forward.z, fs.forward.x))) % 360 + 360) % 360;
		const heading = `${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(hdg / 45) % 8]} ${String(Math.round(hdg)).padStart(3, '0')}°`;
		const mode = `${this.autopilot ? 'AUTOPILOT' : this.grab.active ? 'YOKE' : 'PILOT'} · ${XR_VIEWS[this.view]}`;
		const boost = MathUtils.clamp(fs.boost ?? 0, 0, 1);
		const msgA = this._msg.t > 0 ? MathUtils.clamp(this._msg.t, 0, 1) : 0;
		const footer = this._msg.t > 0 ? this._msg.text : info.sector ? `SECTOR ${info.sector} · ${info.fps ?? ''} FPS` : '';
		const dashKey = [neon, hit, speed, alt, heading, mode, this.autopilot, boost, msgA, footer].join('|');
		if (dashKey !== this._dashKey) {
			this._dashKey = dashKey;
			const { g, canvas: { width: W, height: H } } = this.dash;
			frame(g, W, H, hit ? '#ff3050' : neon, 0.35);
			g.textBaseline = 'alphabetic';
			g.fillStyle = '#e8f6ff';
			g.font = '800 128px Orbitron, sans-serif';
			g.textAlign = 'left';
			g.fillText(speed, 40, 200);
			g.font = '700 30px Rajdhani, sans-serif';
			g.fillStyle = neon;
			g.fillText('KM/H', 46, 246);
			g.textAlign = 'right';
			g.font = '800 72px Orbitron, sans-serif';
			g.fillStyle = '#e8f6ff';
			g.fillText(alt, W - 40, 150);
			g.font = '700 30px Rajdhani, sans-serif';
			g.fillStyle = neon;
			g.fillText('ALT M', W - 44, 192);
			// heading
			g.textAlign = 'center';
			g.font = '800 44px Orbitron, sans-serif';
			g.fillStyle = '#e8f6ff';
			g.fillText(heading, W / 2, 110);
			g.font = '700 32px Rajdhani, sans-serif';
			g.fillStyle = this.autopilot ? pink : neon;
			g.fillText(mode, W / 2, 160);
			// boost bar
			const bw = W * 0.34, bx = W / 2 - bw / 2, by = 196;
			g.fillStyle = 'rgba(255,255,255,0.12)';
			g.fillRect(bx, by, bw, 14);
			g.fillStyle = pink;
			g.shadowColor = pink;
			g.shadowBlur = 14;
			g.fillRect(bx, by, bw * boost, 14);
			g.shadowBlur = 0;
			if (this._msg.t > 0) {
				g.font = '700 34px Rajdhani, sans-serif';
				g.fillStyle = `rgba(255,255,255,${msgA})`;
				g.fillText(footer, W / 2, 270);
			} else if (footer) {
				g.font = '700 26px Rajdhani, sans-serif';
				g.fillStyle = 'rgba(200,230,255,0.6)';
				g.fillText(footer, W / 2, 270);
			}
			this.dash.commit();
		}
		const clock = new Date().toTimeString().slice(0, 5);
		if (this.hands.left && this._wristKey !== neon + clock) {
			this._wristKey = neon + clock;
			const { g, canvas: { width: W, height: H } } = this.wrist;
			frame(g, W, H, pink, 0.6);
			g.textAlign = 'left';
			g.font = '800 30px Orbitron, sans-serif';
			g.fillStyle = '#e8f6ff';
			g.fillText('新京都 KX-11', 28, 52);
			g.textAlign = 'right';
			g.fillStyle = neon;
			g.fillText(clock, W - 28, 52);
			g.textAlign = 'left';
			g.font = '700 24px Rajdhani, sans-serif';
			const rows = [
				['RT / LT', 'THRUST / BRAKE'], ['L-STICK', 'STEER'], ['R-STICK', 'CLIMB / DIVE'], ['GRIP ×2', 'GRAB THE YOKE'],
				['A', 'BOOST'], ['B', 'VIEW'], ['X', 'AUTOPILOT'], ['Y', 'RECENTER · HOLD: EXIT'],
			];
			rows.forEach(([k, v], i) => {
				const y = 96 + i * 27;
				g.fillStyle = pink;
				g.fillText(k, 30, y);
				g.fillStyle = 'rgba(230,245,255,0.92)';
				g.fillText(v, 150, y);
			});
			this.wrist.commit();
		}
	}
}
