// Autopilot that flies the street canyons of the infinite grid.
//
// The route is planned intersection by intersection (mostly straight, sometimes a
// 90 degree turn), as a chain of line and quadratic-Bezier pieces in absolute
// three-space XZ. Altitude is planned per street link and pushed under/over the
// skybridges that the Geometry Nodes layout put on that street, so the car never
// clips one - it dives beneath them instead, which is half the fun.

import { Vector3, MathUtils } from 'three/webgpu';

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // grid (di, dj); dj is Blender +Y = three -Z

class Line {
	constructor(a, b) { this.a = a; this.b = b; this.len = Math.hypot(b.x - a.x, b.z - a.z); this.turn = 0; }
	at(t, out) { return out.set(this.a.x + (this.b.x - this.a.x) * t, 0, this.a.z + (this.b.z - this.a.z) * t); }
	tan(t, out) { return out.set(this.b.x - this.a.x, 0, this.b.z - this.a.z).normalize(); }
}

class Bezier {
	constructor(a, c, b, turn) {
		this.a = a; this.c = c; this.b = b; this.turn = turn;
		// arc-length table
		this.lut = [0];
		const p = new Vector3(), q = new Vector3();
		this.at(0, q);
		let L = 0;
		for (let i = 1; i <= 24; i++) {
			this.at(i / 24, p);
			L += p.distanceTo(q);
			this.lut.push(L);
			q.copy(p);
		}
		this.len = L;
	}
	_t(u) { // arc-length fraction -> bezier t
		const s = u * this.len, lut = this.lut;
		for (let i = 1; i < lut.length; i++) {
			if (lut[i] >= s) return (i - 1 + (s - lut[i - 1]) / Math.max(lut[i] - lut[i - 1], 1e-6)) / 24;
		}
		return 1;
	}
	at(u, out, raw = false) {
		const t = raw ? u : this._t(u), m = 1 - t;
		return out.set(m * m * this.a.x + 2 * m * t * this.c.x + t * t * this.b.x, 0, m * m * this.a.z + 2 * m * t * this.c.z + t * t * this.b.z);
	}
	tan(u, out) {
		const t = this._t(u), m = 1 - t;
		return out.set(2 * m * (this.c.x - this.a.x) + 2 * t * (this.b.x - this.c.x), 0, 2 * m * (this.c.z - this.a.z) + 2 * t * (this.b.z - this.c.z)).normalize();
	}
}

export class Autopilot {
	constructor(layout, seed = 1) {
		this.layout = layout;
		this.rand = mulberry(seed);
		this.cruise = 46;
		this.boost = 0;
		this.turnSpeed = 21;
		this.radius = 10.5;
		this.pos = new Vector3();
		this.forward = new Vector3(1, 0, 0);
		this.vel = new Vector3();
		this.bank = 0;
		this.pitch = 0;
		this.speed = 30;
		this.alt = 60;
		this.altVel = 0;
		this.distance = 0; // total travelled
	}

	get pitchM() { return this.layout.pitch; }

	reset(i, j, dirIndex = 0) {
		this.pieces = [];
		this.pieceStart = []; // cumulative distance at the start of each piece
		this.altPlan = []; // { s0, s1, alt }
		this.node = { i, j };
		this.dir = dirIndex;
		this.cursor = new Vector3(i * this.pitchM, 0, -j * this.pitchM);
		this.planned = 0;
		this.lastAlt = 55;
		this.sinceTurn = 0;
		this.cur = 0;
		this.u = 0;
		this.distance = 0;
		this.alt = 55;
		while (this.planned < 900) this._planNode();
		this.pieces[0].at(0, this.pos);
		this.pos.y = this.alt;
	}

	_nodePos(i, j) { return new Vector3(i * this.pitchM, 0, -j * this.pitchM); }

	_planNode() {
		const { i, j } = this.node;
		const r = this.rand();
		let out = this.dir;
		if (this.sinceTurn >= 2 && r < 0.3) out = (this.dir + (r < 0.15 ? 1 : 3)) % 4;
		const [di, dj] = DIRS[out];
		const N = this._nodePos(i, j);
		if (out === this.dir) {
			this._push(new Line(this.cursor.clone(), N));
			this.cursor = N;
			this.sinceTurn++;
		} else {
			const [pi, pj] = DIRS[this.dir];
			const a = new Vector3(N.x - pi * this.radius, 0, N.z + pj * this.radius);
			const b = new Vector3(N.x + di * this.radius, 0, N.z - dj * this.radius);
			this._push(new Line(this.cursor.clone(), a));
			const turnSign = ((out - this.dir + 4) % 4) === 1 ? 1 : -1;
			this._push(new Bezier(a, N, b, turnSign));
			this.cursor = b;
			this.sinceTurn = 0;
		}
		// altitude for the street link leaving this node
		const ni = i + di, nj = j + dj;
		const s0 = this.planned;
		let alt = MathUtils.clamp(this.lastAlt + (this.rand() - 0.5) * 50, 28, 105);
		const roll = this.rand();
		if (roll < 0.12) alt = 20 + this.rand() * 6; // canyon dive
		else if (roll < 0.2) alt = 120 + this.rand() * 40; // climb above the roofs
		const bridges = dj === 0
			? this.layout.bridgesOnStreet('y', Math.min(i, ni), j)
			: this.layout.bridgesOnStreet('x', i, Math.min(j, nj));
		for (const b of bridges) {
			if (alt > b.z0 - 7 && alt < b.z1 + 7) alt = b.z0 - 9 > 16 ? b.z0 - 9 : b.z1 + 9;
		}
		this.altPlan.push({ s0, s1: s0 + this.pitchM, alt });
		this.lastAlt = alt;
		this.node = { i: ni, j: nj };
		this.dir = out;
	}

	_push(piece) {
		if (piece.len < 0.01) return;
		this.pieceStart.push(this.planned);
		this.pieces.push(piece);
		this.planned += piece.len;
	}

	altitudeAt(s) {
		for (let k = this.altPlan.length - 1; k >= 0; k--) if (this.altPlan[k].s0 <= s) return this.altPlan[k].alt;
		return this.lastAlt;
	}

	/** Absolute XZ + planned altitude at path distance s (for cameras placed ahead of the car). */
	sample(s, out = new Vector3()) {
		let k = this.cur;
		while (k > 0 && this.pieceStart[k] > s) k--;
		while (k + 1 < this.pieces.length && this.pieceStart[k + 1] <= s) k++;
		const p = this.pieces[k];
		const u = MathUtils.clamp((s - this.pieceStart[k]) / p.len, 0, 1);
		p.at(u, out);
		out.y = this.altitudeAt(s);
		return out;
	}

	nextTurnDistance(s) {
		for (let k = this.cur; k < this.pieces.length; k++) {
			if (this.pieces[k].turn) return Math.max(this.pieceStart[k] - s, 0);
		}
		return Infinity;
	}

	update(dt) {
		const s = this.pieceStart[this.cur] + this.u * this.pieces[this.cur].len;
		// speed: brake ahead of turns, boost on demand
		const dTurn = this.nextTurnDistance(s);
		const inTurn = this.pieces[this.cur].turn !== 0;
		const cruise = this.cruise * (1 + this.boost * 0.9);
		const brake = Math.sqrt(this.turnSpeed ** 2 + 2 * 14 * Math.max(dTurn - 4, 0));
		const target = inTurn ? this.turnSpeed : Math.min(cruise, brake);
		const a = target > this.speed ? 9 * (1 + this.boost) : 22;
		this.speed += MathUtils.clamp(target - this.speed, -a * dt, a * dt);

		// advance along the pieces
		let left = this.speed * dt;
		while (left > 0) {
			const p = this.pieces[this.cur];
			const rem = (1 - this.u) * p.len;
			if (left < rem) { this.u += left / p.len; left = 0; }
			else {
				left -= rem;
				this.cur++;
				this.u = 0;
			}
		}
		this.distance += this.speed * dt;
		const sNow = this.pieceStart[this.cur] + this.u * this.pieces[this.cur].len;
		while (this.planned - sNow < 900) this._planNode();
		// forget old pieces
		if (this.cur > 40) {
			this.pieces.splice(0, 20);
			this.pieceStart.splice(0, 20);
			this.cur -= 20;
			while (this.altPlan.length > 4 && this.altPlan[1].s1 < sNow - 400) this.altPlan.shift();
		}

		// altitude: critically damped spring towards the plan, looking ~2 s ahead
		const tAlt = Math.max(this.altitudeAt(sNow + this.speed * 1.6), this.altitudeAt(sNow + 10));
		const w = 1.25;
		const acc = w * w * (tAlt - this.alt) - 2 * w * this.altVel;
		this.altVel += acc * dt;
		this.alt += this.altVel * dt;

		const p = this.pieces[this.cur];
		const prev = this.pos.clone();
		p.at(this.u, this.pos);
		this.pos.y = this.alt;
		const tan = p.tan(this.u, new Vector3());
		this.vel.subVectors(this.pos, prev).divideScalar(Math.max(dt, 1e-4));

		// orientation: bank into turns, pitch with climb rate
		const curvature = p.turn ? p.turn * (1 / this.radius) * Math.sin(Math.PI * this.u) : 0;
		const bankTarget = MathUtils.clamp(-curvature * this.speed * this.speed * 0.012, -1.15, 1.15);
		this.bank = MathUtils.damp(this.bank, bankTarget, 6, dt);
		this.pitch = MathUtils.damp(this.pitch, Math.atan2(this.altVel, Math.max(this.speed, 1)) * 0.8, 5, dt);
		this.forward.copy(tan);
		this.pathS = sNow;
		return this;
	}
}

function mulberry(a) {
	return () => {
		a |= 0; a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
