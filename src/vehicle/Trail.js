// Camera-facing ribbon that records a point's history (light trails).
import { BufferGeometry, BufferAttribute, Mesh, MeshBasicNodeMaterial, AdditiveBlending, DoubleSide, Vector3 } from 'three/webgpu';
import { attribute, uniform, pow, float, smoothstep, distance, positionWorld, cameraPosition } from 'three/tsl';
import { additiveMRT } from '../materials/additiveMRT.js';

const _a = new Vector3(), _b = new Vector3(), _v = new Vector3(), _side = new Vector3();

export class Trail {
	constructor({ color, width = 0.2, length = 60, samples = 90 }) {
		this.n = samples;
		this.width = width;
		this.maxLen = length;
		this.points = [];
		const g = new BufferGeometry();
		this.pos = new BufferAttribute(new Float32Array(samples * 2 * 3), 3);
		this.fade = new BufferAttribute(new Float32Array(samples * 2), 1);
		const idx = [];
		for (let i = 0; i < samples - 1; i++) {
			const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
			idx.push(a, b, c, b, d, c);
		}
		g.setIndex(idx);
		g.setAttribute('position', this.pos);
		g.setAttribute('aFade', this.fade);
		this.color = uniform(color);
		this.intensity = uniform(1.6);
		const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
		m.mrtNode = additiveMRT();
		const f = attribute('aFade', 'float');
		// fade out close to the lens so chase cameras don't get a beam in the face
		const near = smoothstep(3.0, 14.0, distance(positionWorld, cameraPosition));
		m.colorNode = this.color.mul(pow(f, float(1.6))).mul(this.intensity).mul(near);
		this.mesh = new Mesh(g, m);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 20;
	}

	push(p, camera, dt) {
		const last = this.points[0];
		if (!last || last.distanceTo(p) > 0.4) this.points.unshift(p.clone());
		else last.copy(p);
		// trim to length
		let L = 0;
		for (let i = 1; i < this.points.length; i++) {
			L += this.points[i].distanceTo(this.points[i - 1]);
			if (L > this.maxLen || i >= this.n) { this.points.length = i; break; }
		}
		this._build(camera);
	}

	shift(delta) { for (const p of this.points) p.sub(delta); }

	_build(camera) {
		const P = this.pos.array, F = this.fade.array, pts = this.points, n = this.n;
		const cnt = Math.min(pts.length, n);
		if (!cnt) return;
		let L = 0;
		for (let i = 0; i < n; i++) {
			const k = Math.min(i, cnt - 1);
			const p = pts[k];
			const prev = pts[Math.max(k - 1, 0)], next = pts[Math.min(k + 1, cnt - 1)];
			_v.subVectors(prev, next);
			if (_v.lengthSq() < 1e-8) _v.set(1, 0, 0);
			_b.subVectors(camera.position, p);
			_side.crossVectors(_v, _b).normalize().multiplyScalar(this.width * (1 - (i / n) * 0.6));
			if (i > 0 && i < cnt) L += pts[i].distanceTo(pts[i - 1]);
			const f = i < cnt ? Math.max(1 - L / this.maxLen, 0) : 0;
			P.set([p.x + _side.x, p.y + _side.y, p.z + _side.z, p.x - _side.x, p.y - _side.y, p.z - _side.z], i * 6);
			F[i * 2] = F[i * 2 + 1] = f;
		}
		this.pos.needsUpdate = true;
		this.fade.needsUpdate = true;
	}
}
