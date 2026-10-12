// Player-controlled hover flight (arcade): throttle / steer / lift / boost, with
// collision against the actual Geometry Nodes buildings and skybridges (queried
// from the same deterministic layout the city is streamed from). Exposes the
// same state shape as the Autopilot so the car, HUD and cameras accept either.

import { Vector3, MathUtils } from 'three/webgpu';

const R_H = 1.7; // car collision radius (horizontal)
const R_V = 0.9; // half height

export class PlayerFlight {
	constructor(layout) {
		this.layout = layout;
		this.pos = new Vector3(); // absolute three-space
		this.forward = new Vector3(1, 0, 0);
		this.yaw = 0;
		this.yawRate = 0;
		this.speed = 0;
		this.vy = 0;
		this.bank = 0;
		this.pitch = 0;
		this.boost = 0;
		this.distance = 0;
		this.alt = 50;
		this.altVel = 0;
		this.impact = 0; // 0..1, decays: drives camera shake / HUD flash
	}

	/** Take over from the autopilot without a visual jump. */
	from(ap) {
		this.pos.copy(ap.pos);
		this.yaw = Math.atan2(-ap.forward.z, ap.forward.x);
		this.speed = ap.speed;
		this.vy = ap.altVel ?? 0;
		this.bank = ap.bank;
		this.pitch = ap.pitch;
		this.distance = ap.distance;
		this.yawRate = 0;
	}

	update(dt, input) {
		const boost = input.boost ? 1 : 0;
		this.boost = MathUtils.damp(this.boost, boost, 4, dt);
		const maxSpeed = 62 + this.boost * 58;
		// steering: sharper at low speed
		const turn = MathUtils.lerp(1.9, 0.95, MathUtils.clamp(Math.abs(this.speed) / 90, 0, 1));
		this.yawRate = MathUtils.damp(this.yawRate, -input.steer * turn, 7, dt);
		this.yaw += this.yawRate * dt;
		this.forward.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		// throttle / brake / drag
		const accel = input.throttle >= 0 ? input.throttle * (26 + this.boost * 50) : input.throttle * 48;
		this.speed += accel * dt;
		this.speed -= this.speed * (input.throttle === 0 ? 0.45 : 0.18) * dt;
		this.speed = MathUtils.clamp(this.speed, -18, maxSpeed);
		// lift
		this.vy = MathUtils.damp(this.vy, input.lift * 24, 3.2, dt);
		this.pos.addScaledVector(this.forward, this.speed * dt);
		this.pos.y += this.vy * dt;
		this.impact = Math.max(0, this.impact - dt * 2.5);
		this._collide();
		// presentation
		this.bank = MathUtils.damp(this.bank, MathUtils.clamp(-this.yawRate * Math.abs(this.speed) * 0.028, -1.15, 1.15), 5, dt);
		this.pitch = MathUtils.damp(this.pitch, Math.atan2(this.vy, Math.max(Math.abs(this.speed), 6)) * 0.8 - input.throttle * 0.04, 5, dt);
		this.alt = this.pos.y;
		this.altVel = this.vy;
		this.distance += Math.abs(this.speed) * dt;
		return this;
	}

	_collide() {
		const L = this.layout, P = L.pitch;
		// three -> Blender space
		let X = this.pos.x, Y = -this.pos.z, Z = this.pos.y;
		const bx = Math.floor(X / P), by = Math.floor(Y / P);
		let hit = false;
		for (let j = by - 1; j <= by + 1; j++) {
			for (let i = bx - 1; i <= bx + 1; i++) {
				for (const b of L.solids(i, j)) {
					const x0 = b[0] - R_H, y0 = b[1] - R_H, z0 = b[2] - R_V, x1 = b[3] + R_H, y1 = b[4] + R_H, z1 = b[5] + R_V;
					if (X <= x0 || X >= x1 || Y <= y0 || Y >= y1 || Z <= z0 || Z >= z1) continue;
					// push out along the axis of least penetration
					const d = [X - x0, x1 - X, Y - y0, y1 - Y, Z - z0, z1 - Z];
					let k = 0;
					for (let q = 1; q < 6; q++) if (d[q] < d[k]) k = q;
					const n = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][k];
					X += n[0] * d[k]; Y += n[1] * d[k]; Z += n[2] * d[k];
					if (k >= 4) {
						this.vy = k === 5 ? Math.max(this.vy, 0) : Math.min(this.vy, 0);
					} else {
						// scrape: lose the velocity going into the wall, keep the tangential part
						const nx = n[0], nz = -n[1];
						const into = this.forward.x * nx + this.forward.z * nz;
						if (into * this.speed < 0) this.speed *= 1 - 0.75 * Math.abs(into);
						this.impact = Math.min(1, this.impact + Math.abs(into) * Math.abs(this.speed) / 40);
					}
					hit = true;
				}
			}
		}
		if (hit) this.pos.set(X, Z, -Y);
		if (this.pos.y < 1.5) { this.pos.y = 1.5; this.vy = Math.max(this.vy, 0); }
		if (this.pos.y > 900) { this.pos.y = 900; this.vy = Math.min(this.vy, 0); }
	}
}

/** Keyboard + gamepad + on-screen touch controls -> { throttle, steer, lift, boost }. */
export class FlightInput {
	constructor() {
		this.keys = new Set();
		this.lastActive = 0;
		// written by TouchControls; held counts the fingers currently on a control
		this.touch = { throttle: 0, steer: 0, lift: 0, boost: false, held: 0 };
		window.addEventListener('keydown', (e) => {
			if (e.target.closest?.('.lil-gui')) return;
			this.keys.add(e.code);
			if (FlightInput.DRIVE_KEYS.has(e.code)) {
				this.lastActive = performance.now();
				if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
			}
		});
		window.addEventListener('keyup', (e) => this.keys.delete(e.code));
		window.addEventListener('blur', () => this.keys.clear());
	}

	static DRIVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'ControlLeft']);

	read() {
		const k = this.keys;
		const ax = (a, b) => (k.has(a) ? 1 : 0) - (k.has(b) ? 1 : 0);
		const s = {
			throttle: ax('KeyW', 'KeyS') || ax('ArrowUp', 'ArrowDown'),
			steer: ax('KeyD', 'KeyA') || ax('ArrowRight', 'ArrowLeft'),
			lift: ax('KeyE', 'KeyQ') || (k.has('Space') ? 1 : 0) - (k.has('ControlLeft') ? 1 : 0),
			boost: k.has('ShiftLeft') || k.has('ShiftRight'),
		};
		const t = this.touch;
		s.throttle = s.throttle || t.throttle;
		s.steer = s.steer || t.steer;
		s.lift = s.lift || t.lift;
		s.boost = s.boost || t.boost;
		const pad = navigator.getGamepads?.().find((p) => p && p.connected);
		if (pad) {
			const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
			const rt = pad.buttons[7]?.value ?? 0, lt = pad.buttons[6]?.value ?? 0;
			const steer = dz(pad.axes[0] ?? 0), lift = -dz(pad.axes[3] ?? pad.axes[1] ?? 0);
			if (rt || lt || steer || lift || pad.buttons[0]?.pressed) this.lastActive = performance.now();
			s.throttle = s.throttle || rt - lt;
			s.steer = s.steer || steer;
			s.lift = s.lift || lift;
			s.boost = s.boost || !!pad.buttons[0]?.pressed || !!pad.buttons[5]?.pressed;
		}
		return s;
	}

	/** True while any flight control is being used. */
	get active() { return performance.now() - this.lastActive < 400 || this.touch.held > 0 || [...this.keys].some((c) => FlightInput.DRIVE_KEYS.has(c)); }
}

/** True if an absolute three-space point is inside a building / skybridge (+margin). */
export function insideSolids(layout, p, margin = 1.2) {
	const P = layout.pitch, X = p.x, Y = -p.z, Z = p.y;
	const bx = Math.floor(X / P), by = Math.floor(Y / P);
	for (let j = by - 1; j <= by + 1; j++) {
		for (let i = bx - 1; i <= bx + 1; i++) {
			for (const b of layout.solids(i, j)) {
				if (X > b[0] - margin && X < b[3] + margin && Y > b[1] - margin && Y < b[4] + margin && Z > b[2] - margin && Z < b[5] + margin) return true;
			}
		}
	}
	return false;
}
