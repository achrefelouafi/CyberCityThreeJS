// Cinematic camera director. In "cinematic" mode it cuts between hand-tuned
// shots every few seconds (chase, low wide, head-on, side track, fly-by, top
// down, establishing crane, orbit). Cameras that need to sit in front of the car
// are placed on the autopilot's *future* path, so they always stay inside the
// street canyon instead of clipping into buildings.

import { Vector3, Quaternion, Euler, MathUtils } from 'three/webgpu';

const UP = new Vector3(0, 1, 0);
const _f = new Vector3(), _r = new Vector3(), _p = new Vector3(), _l = new Vector3(), _q = new Vector3();
const _qa = new Quaternion(), _qb = new Quaternion(), _e = new Euler();
export const DRIVE_CAMS = ['CHASE CAM', 'WIDE CAM', 'COCKPIT', 'HOOD CAM'];

export const SHOTS = ['chase', 'low', 'front', 'side', 'flyby', 'top', 'crane', 'orbit', 'chase'];
const LABELS = {
	chase: 'PURSUIT', low: 'LOW ANGLE', front: 'HEAD-ON', side: 'TRACKING', flyby: 'FLY-BY',
	top: 'OVERHEAD', crane: 'ESTABLISHING', orbit: 'ORBIT',
};

export class Director {
	constructor(camera) {
		this.camera = camera;
		this.mode = 'cinematic'; // cinematic | chase | free
		this.shot = 'chase';
		this.shotTime = 0;
		this.shotLen = 6;
		this.order = [];
		this.pos = new Vector3();
		this.look = new Vector3();
		this.anchor = new Vector3(); // absolute anchor for static shots
		this.fov = 62;
		this.roll = 0;
		this.cut = true;
		this.onShot = null;
		this.orbitA = 0;
		this.shake = 1;
		// pilot camera: mouse-drag orbit offset around the car, eases back when released
		this.drag = { yaw: 0, pitch: 0, active: false };
		this.driveCam = 0; // 0 chase, 1 wide, 2 cockpit (first person), 3 hood
		this.inCockpit = false;
		this.zoom = 1; // mouse wheel
	}

	cycleDriveCam() {
		this.setDriveCam((this.driveCam + 1) % DRIVE_CAMS.length);
	}

	setDriveCam(i) {
		this.driveCam = i;
		this.drag.yaw = this.drag.pitch = 0;
		this.onShot?.(DRIVE_CAMS[i]);
	}

	/** First person: rigidly mounted at the driver's eye, free look with the mouse. */
	_cockpit(dt, car, ap) {
		if (!this.drag.active) {
			this.drag.yaw = MathUtils.damp(this.drag.yaw, 0, 2.5, dt);
			this.drag.pitch = MathUtils.damp(this.drag.pitch, 0, 2.5, dt);
		}
		const cam = this.camera, v = Math.abs(ap.speed);
		car.body.updateMatrixWorld();
		// the head leans against the bank and settles back under acceleration
		_p.copy(car.eye).add(_q.set(-MathUtils.clamp(ap.boost, 0, 1) * 0.05, 0, ap.bank * 0.06));
		const t = performance.now() * 0.001, sh = this.shake * MathUtils.clamp(v / 80, 0, 1.2) * 0.004;
		_p.x += Math.sin(t * 23.1) * sh;
		_p.y += Math.sin(t * 31.7 + 1) * sh;
		car.body.localToWorld(_p);
		cam.position.copy(_p);
		car.body.getWorldQuaternion(_qa);
		_e.set(-0.05 - this.drag.pitch * 0.9, -Math.PI / 2 + this.drag.yaw * 1.4, 0, 'YXZ');
		cam.quaternion.copy(_qa).multiply(_qb.setFromEuler(_e));
		const fov = 76 + MathUtils.clamp(v - 25, 0, 90) * 0.12 + ap.boost * 8;
		this.fov = MathUtils.damp(this.fov, fov, 3, dt);
		cam.fov = this.fov;
		cam.near = 0.05;
		cam.updateProjectionMatrix();
		// keep the follow-cam state continuous for when we leave the cockpit
		this.pos.copy(cam.position);
		this.look.copy(cam.position).add(_q.set(0, 0, -10).applyQuaternion(cam.quaternion));
		this.roll = 0;
	}

	attachMouse(el) {
		// one pointer drives the look; a second finger landing on the city doesn't hijack it
		let lx = 0, ly = 0, id = null;
		el.addEventListener('pointerdown', (e) => {
			if (this.mode !== 'drive' || id !== null) return;
			id = e.pointerId; this.drag.active = true; lx = e.clientX; ly = e.clientY;
			el.setPointerCapture?.(e.pointerId);
		});
		el.addEventListener('pointermove', (e) => {
			if (!this.drag.active || e.pointerId !== id) return;
			this.drag.yaw -= (e.clientX - lx) * 0.006;
			this.drag.pitch = MathUtils.clamp(this.drag.pitch + (e.clientY - ly) * 0.004, -0.5, 1.1);
			lx = e.clientX; ly = e.clientY;
		});
		el.addEventListener('wheel', (e) => {
			if (this.mode !== 'drive') return;
			this.zoom = MathUtils.clamp(this.zoom * Math.exp(e.deltaY * 0.001), 0.45, 3.5);
			e.preventDefault();
		}, { passive: false });
		const up = (e) => { if (e.pointerId === id) { id = null; this.drag.active = false; } };
		el.addEventListener('pointerup', up);
		el.addEventListener('pointercancel', up);
	}

	setMode(mode) {
		this.mode = mode;
		if (mode === 'chase') this._start('chase');
		if (mode === 'cinematic') this._next();
	}

	_next() {
		if (!this.order.length) {
			this.order = SHOTS.slice(1).sort(() => Math.random() - 0.5);
			this.order.unshift('chase');
		}
		let s = this.order.shift();
		if (s === this.shot) s = this.order.shift() ?? 'chase';
		this._start(s);
	}

	_start(shot) {
		this.shot = shot;
		this.shotTime = 0;
		this.shotLen = { chase: 7, low: 5.5, front: 5, side: 5, flyby: 4.2, top: 5, crane: 6, orbit: 7 }[shot];
		this.cut = true;
		this.orbitA = Math.random() * Math.PI * 2;
		this.side = Math.random() < 0.5 ? 1 : -1;
		this.onShot?.(LABELS[shot]);
	}

	/**
	 * @param car       HoverCar (render-space root)
	 * @param ap        Autopilot (absolute path)
	 * @param origin    render origin (absolute = render + origin)
	 */
	update(dt, car, ap, origin) {
		if (this.mode === 'free') return;
		this.inCockpit = this.mode === 'drive' && this.driveCam === 2;
		if (this.inCockpit) { this._cockpit(dt, car, ap); return; }
		if (this.camera.near !== 0.25) { this.camera.near = 0.25; this.camera.updateProjectionMatrix(); }
		this.shotTime += dt;
		if (this.mode === 'cinematic' && this.shotTime > this.shotLen) this._next();
		const C = car.root.position;
		_f.copy(ap.forward).setY(0).normalize();
		_r.crossVectors(_f, UP).normalize();
		const s = ap.pathS, v = ap.speed;
		const toRender = (abs, out) => out.copy(abs).sub(origin);
		let lambda = 5, fov = 62, roll = 0;

		switch (this.mode === 'chase' ? 'chase' : this.mode === 'drive' ? 'drive' : this.shot) {
			case 'drive': {
				// third-person pilot camera (+ mouse orbit), punchy FOV with speed / boost
				if (!this.drag.active) {
					this.drag.yaw = MathUtils.damp(this.drag.yaw, 0, 1.5, dt);
					this.drag.pitch = MathUtils.damp(this.drag.pitch, 0, 1.5, dt);
				}
				const cy = Math.cos(this.drag.yaw), sy = Math.sin(this.drag.yaw);
				fov = 64 + MathUtils.clamp(Math.abs(v) - 25, 0, 90) * 0.28 + ap.boost * 10;
				if (this.driveCam === 3) {
					// hood: just above the canopy, looking down the road
					_p.copy(C).addScaledVector(_f, 0.9).add(_q.set(0, 1.25, 0));
					_l.copy(_p).addScaledVector(_f, 30 * cy).addScaledVector(_r, 30 * sy).add(_q.set(0, -1.5 - this.drag.pitch * 20, 0));
					fov += 8;
					roll = ap.bank * 0.9;
					lambda = 40;
					break;
				}
				const wide = this.driveCam === 1;
				const back = ((wide ? 22 : 10.5) + Math.max(0, v) * 0.03) * this.zoom;
				const dir = _q.copy(_f).multiplyScalar(-cy).addScaledVector(_r, sy);
				_p.copy(C).addScaledVector(dir, back * Math.cos(this.drag.pitch));
				_p.y = C.y + (wide ? 6.5 : 2.8) * Math.sqrt(this.zoom) + back * Math.sin(this.drag.pitch) + Math.max(0, ap.altVel) * 0.04;
				_l.copy(C).addScaledVector(_f, 9 * cy).add(_q.set(0, 1.0, 0));
				if (wide) fov -= 6;
				roll = ap.bank * 0.25;
				lambda = 7;
				break;
			}
			case 'chase': {
				ap.sample(s - 10.5, _p);
				toRender(_p, _p);
				_p.y = C.y + 2.7 + Math.max(0, ap.altVel) * 0.05;
				_l.copy(C).addScaledVector(_f, 8).add(_q.set(0, 0.9, 0));
				fov = 60 + MathUtils.clamp(v - 30, 0, 60) * 0.35 + ap.boost * 8;
				roll = ap.bank * 0.3;
				lambda = 6;
				break;
			}
			case 'low': {
				ap.sample(s - 6.5, _p);
				toRender(_p, _p);
				_p.addScaledVector(_r, 2.3 * this.side);
				_p.y = C.y + 0.15;
				_l.copy(C).addScaledVector(_f, 12).add(_q.set(0, 1.2, 0));
				fov = 82;
				roll = ap.bank * 0.5 + 0.08 * this.side;
				lambda = 8;
				break;
			}
			case 'front': {
				ap.sample(s + 10.5, _p);
				toRender(_p, _p);
				_p.addScaledVector(_r, 1.4 * this.side);
				_p.y = C.y + 1.3;
				_l.copy(C).add(_q.set(0, 0.7, 0));
				fov = 46;
				roll = -ap.bank * 0.2;
				lambda = 7;
				break;
			}
			case 'side': {
				_p.copy(C).addScaledVector(_r, 8.5 * this.side).addScaledVector(_f, 1.5);
				_p.y = C.y + 1.0;
				_l.copy(C).addScaledVector(_f, 1.2).add(_q.set(0, 0.6, 0));
				fov = 40;
				lambda = 9;
				break;
			}
			case 'flyby': {
				if (this.cut) {
					ap.sample(s + v * 2.2, this.anchor);
					const fa = new Vector3();
					ap.sample(s + v * 2.2 + 1, fa).sub(this.anchor).setY(0).normalize();
					const ra = new Vector3().crossVectors(fa, UP);
					this.anchor.addScaledVector(ra, 6.5 * this.side);
					this.anchor.y = ap.altitudeAt(s + v * 2.2) + (Math.random() < 0.5 ? -2.5 : 3.5);
				}
				toRender(this.anchor, _p);
				_l.copy(C).add(_q.set(0, 0.5, 0));
				const d = _p.distanceTo(C);
				fov = MathUtils.clamp(28 + d * 0.45, 30, 70);
				lambda = 1e4;
				break;
			}
			case 'top': {
				_p.copy(C).add(_q.set(0, 32, 0)).addScaledVector(_f, -4);
				_l.copy(C).addScaledVector(_f, 6);
				fov = 55;
				roll = this.shotTime * 0.08;
				lambda = 4;
				break;
			}
			case 'crane': {
				if (this.cut) {
					ap.sample(s + v * 4.5, this.anchor);
					this.anchor.y = Math.max(ap.altitudeAt(s + v * 4.5) + 95, 240); // above the skyline
				}
				toRender(this.anchor, _p);
				_p.y += this.shotTime * 4;
				_l.copy(C);
				fov = 38;
				lambda = 1e4;
				break;
			}
			case 'orbit': {
				this.orbitA += dt * 0.45 * this.side;
				_p.copy(C).addScaledVector(_r, Math.cos(this.orbitA) * 8.5).addScaledVector(_f, Math.sin(this.orbitA) * 8.5);
				_p.y = C.y + 1.6;
				_l.copy(C).add(_q.set(0, 0.5, 0));
				fov = 48;
				lambda = 1e4;
				break;
			}
		}

		// keep follow cameras out of buildings: slide in towards the car until clear
		if (this.solidTest && (this.mode === 'drive' || this.mode === 'chase' || this.shot === 'chase' || this.shot === 'low')) {
			const abs = _q.copy(_p).add(origin);
			if (this.solidTest(abs)) {
				const car = _l.clone().copy(C).add(origin);
				let lo = 0, hi = 1; // fraction from car (0) to desired (1)
				for (let k = 0; k < 7; k++) {
					const mid = (lo + hi) / 2;
					abs.lerpVectors(car, _p.clone().add(origin), mid);
					if (this.solidTest(abs)) hi = mid; else lo = mid;
				}
				abs.lerpVectors(car, _p.clone().add(origin), lo);
				_p.copy(abs).sub(origin);
				lambda = Math.max(lambda, 14);
			}
		}

		// never smooth from an invalid state (e.g. a shot evaluated before the path existed)
		if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.look.x + this.look.y + this.look.z)) this.cut = true;
		if (!Number.isFinite(_p.x + _p.y + _p.z + _l.x + _l.y + _l.z)) return;
		if (this.cut) {
			this.pos.copy(_p);
			this.look.copy(_l);
			this.fov = fov;
			this.roll = roll;
			this.cut = false;
		} else {
			const k = 1 - Math.exp(-lambda * dt);
			this.pos.lerp(_p, k);
			this.look.lerp(_l, Math.min(1, k * 1.6));
			this.fov = MathUtils.damp(this.fov, fov, 3, dt);
			this.roll = MathUtils.damp(this.roll, roll, 4, dt);
		}
		const cam = this.camera;
		cam.position.copy(this.pos);
		// handheld micro-shake that grows with speed
		const t = performance.now() * 0.001;
		const sh = this.shake * (MathUtils.clamp(Math.abs(v) / 60, 0, 1.5) * 0.04 + (ap.impact ?? 0) * 0.5);
		cam.position.x += Math.sin(t * 13.1) * sh;
		cam.position.y += Math.sin(t * 17.3 + 1) * sh;
		cam.up.set(0, 1, 0);
		cam.lookAt(this.look);
		cam.rotateZ(this.roll);
		if (Math.abs(cam.fov - this.fov) > 0.01) {
			cam.fov = this.fov;
			cam.updateProjectionMatrix();
		}
	}

	/** Origin rebasing: keep smoothed state continuous. */
	rebase(delta) {
		this.pos.sub(delta);
		this.look.sub(delta);
	}
}
