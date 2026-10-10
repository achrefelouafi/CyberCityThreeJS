// Streams the infinite city around the camera.
//
// The world is cut into chunks of N x N blocks. Each chunk is generated once by
// the Geometry-Nodes-exact layout (CityLayout) into compact per-piece instance
// arrays; every time the set of visible chunks changes, those arrays are packed
// into one InstancedMesh per kit piece (~25 draw calls for the whole city).
// Translations are stored relative to each chunk's corner in float64 and only
// made relative to the floating render origin at pack time, so precision holds
// thousands of kilometres from the start.

import { InstancedMesh, InstancedBufferAttribute, Vector3, Frustum, Matrix4, Box3 } from 'three/webgpu';
import { PIECES } from './layout.js';
import { dressBlock } from './Dressing.js';

// level-of-detail rings (in chunks): small props near, facade signs mid, the rest everywhere
const LOD = Object.fromEntries([...PIECES.roof, ...PIECES.facade, 'P1_Lamp', 'A0_Awning'].map((n) => [n, 'near'])
	.concat(['S0_Blade', 'S1_Wide', 'S2_Tall', 'S4_Disc', 'S5_Banner', 'D0_LedgeBox', 'D1_LedgeRound', 'D2_LedgeOcta', 'D3_LedgeHex'].map((n) => [n, 'mid'])));
const TOWER_STYLE = new Map(PIECES.towers.map((n, i) => [n, i]));
const _frustum = new Frustum(), _m = new Matrix4(), _box = new Box3(), _fwd = new Vector3();

export class CityStreamer {
	constructor({ scene, layout, kit, material, holoMaterial, chunkBlocks = 4, radius = 3, detailRadius = 1, midRadius = 2 }) {
		this.scene = scene;
		this.layout = layout;
		this.material = material;
		this.holoMaterial = holoMaterial;
		this.C = chunkBlocks;
		this.radius = radius;
		this.detailRadius = detailRadius;
		this.midRadius = midRadius;
		this.camera = null;
		this.view = { fwd: new Vector3(), pos: new Vector3(), fov: 0, valid: false };
		this.origin = new Vector3(); // render origin in three-space metres (x, 0, z)
		this.center = { cx: NaN, cy: NaN };
		this.chunks = new Map();
		this.queue = [];
		this.dirty = false;
		this.stats = { instances: 0, chunks: 0, drawCalls: 0 };

		this.pieces = [];
		this.pieceIndex = new Map();
		for (const [name, geometry] of kit) {
			if (name.startsWith('V') || name.startsWith('X')) continue; // vehicles & hologram art live elsewhere
			const p = { name, geometry, lod: LOD[name] ?? 'far', holo: name.startsWith('H'), mesh: null, capacity: 0 };
			this.pieceIndex.set(name, this.pieces.length);
			this.pieces.push(p);
		}
	}

	get pitch() { return this.layout.pitch; }

	/** Blender-space block coordinates of a three-space position. */
	blockAt(pos) {
		const x = pos.x + this.origin.x, y = -(pos.z + this.origin.z);
		return { bx: Math.floor(x / this.pitch), by: Math.floor(y / this.pitch) };
	}

	chunkKey(cx, cy) { return `${cx},${cy}`; }

	// ------------------------------------------------------------------ generation
	generateChunk(cx, cy) {
		const C = this.C;
		const x0 = cx * C * this.pitch, y0 = cy * C * this.pitch; // chunk corner, blender space (float64)
		const lists = this.pieces.map(() => ({ m: [], a: [] }));
		const emit = (piece, x, y, z, r, sx, sy, sz, a0, a1, a2, a3) => {
			const i = this.pieceIndex.get(piece);
			if (i === undefined) return;
			const L = lists[i];
			const c = Math.cos(r), s = Math.sin(r);
			// Blender (x, y, z) -> three (x, z, -y); scales (sx, sy, sz) -> (sx, sz, sy)
			L.m.push(c * sx, 0, -s * sx, 0, 0, sz, 0, 0, s * sy, 0, c * sy, 0, x - x0, z, -(y - y0), 1);
			L.a.push(a0, a1, a2, a3);
		};
		const buf = [], dressed = [];
		const collect = (...e) => buf.push(e);
		for (let j = 0; j < C; j++) {
			for (let i = 0; i < C; i++) {
				buf.length = 0;
				dressed.length = 0;
				this.layout.block(cx * C + i, cy * C + j, collect, true);
				for (const e of dressBlock(buf, TOWER_STYLE, this.layout.p.FH, dressed)) {
					// neon trims share the roof plane with their tower: lift & fatten them a hair (no Z-fight)
					if (e[0] === 'P3_NeonBar') { e[5] += 0.06; e[6] += 0.06; e[7] += 0.08; }
					else if (e[0][0] === 'H') e[11] = e[5]; // hologram shader needs the instance scale
					emit(...e);
				}
			}
		}
		const data = lists.map((L) => ({ count: L.a.length / 4, m: new Float32Array(L.m), a: new Float32Array(L.a) }));
		return { cx, cy, x0, y0, data };
	}

	// ------------------------------------------------------------------ streaming
	update(camera, budgetMs = 3) {
		if (!Number.isFinite(camera.position.x + camera.position.z)) return;
		this.camera = camera;
		const cameraPos = camera.position;
		const { bx, by } = this.blockAt(cameraPos);
		const cx = Math.floor(bx / this.C), cy = Math.floor(by / this.C);
		if (cx !== this.center.cx || cy !== this.center.cy) {
			this.center = { cx, cy };
			this._retarget();
		}
		const t0 = performance.now();
		while (this.queue.length && performance.now() - t0 < budgetMs) {
			const { cx: qx, cy: qy } = this.queue.shift();
			const key = this.chunkKey(qx, qy);
			if (!this.chunks.has(key)) {
				this.chunks.set(key, this.generateChunk(qx, qy));
				this.dirty = true;
			}
		}
		// view-dependent packing: only chunks inside the (padded) frustum are drawn
		camera.getWorldDirection(_fwd);
		const v = this.view;
		if (!v.valid || _fwd.dot(v.fwd) < 0.97 || cameraPos.distanceTo(v.pos) > this.pitch * 1.5 || camera.fov !== v.fov || camera.aspect !== v.aspect) this.dirty = true;
		if (this.dirty) this.pack();
	}

	_retarget() {
		const { cx, cy } = this.center, R = this.radius;
		const want = new Set();
		this.queue.length = 0;
		for (let dy = -R; dy <= R; dy++) {
			for (let dx = -R; dx <= R; dx++) {
				const key = this.chunkKey(cx + dx, cy + dy);
				want.add(key);
				if (!this.chunks.has(key)) this.queue.push({ cx: cx + dx, cy: cy + dy, d: dx * dx + dy * dy });
			}
		}
		this.queue.sort((a, b) => a.d - b.d);
		for (const key of this.chunks.keys()) {
			if (!want.has(key)) { this.chunks.delete(key); this.dirty = true; }
		}
		this.dirty = true; // detail ring moved
	}

	/** Synchronously fill the whole window (used at start-up and after parameter edits). */
	fill(camera) {
		this.camera = camera;
		const { bx, by } = this.blockAt(camera.position);
		this.center = { cx: Math.floor(bx / this.C), cy: Math.floor(by / this.C) };
		this._retarget();
		for (const q of this.queue) {
			const key = this.chunkKey(q.cx, q.cy);
			if (!this.chunks.has(key)) this.chunks.set(key, this.generateChunk(q.cx, q.cy));
		}
		this.queue.length = 0;
		this.pack();
	}

	/** Drop everything (layout parameters changed) and rebuild around the camera. */
	regenerate(camera) {
		this.chunks.clear();
		this.fill(camera);
	}

	// ------------------------------------------------------------------ packing
	_visibleChunks() {
		const all = [...this.chunks.values()];
		const cam = this.camera;
		if (!cam) return all;
		cam.updateMatrixWorld();
		_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
		_frustum.setFromProjectionMatrix(_m);
		const S = this.C * this.pitch, pad = this.pitch * 0.75;
		const out = [];
		for (const ch of all) {
			const x0 = ch.x0 - this.origin.x, z1 = -ch.y0 - this.origin.z;
			_box.min.set(x0 - pad, -10, z1 - S - pad);
			_box.max.set(x0 + S + pad, 900, z1 + pad);
			const ring = Math.max(Math.abs(ch.cx - this.center.cx), Math.abs(ch.cy - this.center.cy));
			if (ring === 0 || _frustum.intersectsBox(_box)) {
				const dx = x0 + S / 2 - cam.position.x, dz = z1 - S / 2 - cam.position.z;
				ch._d = dx * dx + dz * dz;
				out.push(ch);
			}
		}
		return out.sort((a, b) => a._d - b._d); // front to back: better early-z
	}

	pack() {
		this.dirty = false;
		const chunks = this._visibleChunks();
		if (this.camera) {
			this.camera.getWorldDirection(this.view.fwd);
			this.view.pos.copy(this.camera.position);
			this.view.fov = this.camera.fov;
			this.view.aspect = this.camera.aspect;
			this.view.valid = true;
		}
		const { cx, cy } = this.center;
		const ring = (ch) => Math.max(Math.abs(ch.cx - cx), Math.abs(ch.cy - cy));
		const inLod = (p, ch) => p.lod === 'far' || ring(ch) <= (p.lod === 'near' ? this.detailRadius : this.midRadius);
		let total = 0, draws = 0;
		this.pieces.forEach((p, pi) => {
			let n = 0;
			for (const ch of chunks) if (inLod(p, ch)) n += ch.data[pi].count;
			this._ensure(p, n);
			const M = p.mesh.instanceMatrix.array, A = p.inst.array;
			let o = 0;
			for (const ch of chunks) {
				if (!inLod(p, ch)) continue;
				const d = ch.data[pi];
				if (!d.count) continue;
				M.set(d.m, o * 16);
				A.set(d.a, o * 4);
				// chunk corner relative to the render origin (three space)
				const ox = ch.x0 - this.origin.x, oz = -ch.y0 - this.origin.z;
				for (let k = 0; k < d.count; k++) {
					const b = (o + k) * 16;
					M[b + 12] += ox;
					M[b + 14] += oz;
				}
				o += d.count;
			}
			p.mesh.count = n;
			p.mesh.visible = n > 0;
			if (n) {
				// upload just the packed range (capacity is padded for growth)
				const im = p.mesh.instanceMatrix;
				im.clearUpdateRanges();
				im.addUpdateRange(0, n * 16);
				im.needsUpdate = true;
				p.inst.clearUpdateRanges();
				p.inst.addUpdateRange(0, n * 4);
				p.inst.needsUpdate = true;
			}
			total += n;
			if (n) draws++;
		});
		this.stats = { instances: total, chunks: chunks.length, total: this.chunks.size, drawCalls: draws };
		// landmark tops (spires / hologram pylons) for searchlights & other effects
		// (from every loaded chunk, not just the visible ones, so beams don't pop when the view turns)
		this.landmarks = [];
		this.pieces.forEach((p, pi) => {
			if (!(p.name.startsWith('L0') || p.holo)) return;
			for (const ch of this.chunks.values()) {
				const d = ch.data[pi];
				const ox = ch.x0 - this.origin.x, oz = -ch.y0 - this.origin.z;
				for (let i = 0; i < d.count; i++) {
					const y = d.m[i * 16 + 13];
					this.landmarks.push({ x: d.m[i * 16 + 12] + ox, y: p.holo ? y - 6 : y, z: d.m[i * 16 + 14] + oz, seed: d.a[i * 4 + 1] });
				}
			}
		});
		this.onPack?.(this);
	}

	_ensure(p, n) {
		if (p.mesh && n <= p.capacity) return;
		// >= 1100 instances: above the uniform-buffer limit (64 KB WebGPU / 16 KB WebGL), so three
		// feeds instance matrices as vertex attributes. Smaller meshes get a per-mesh UBO baked
		// into the shader, i.e. one unique ~100 KB shader *per kit piece* and per resize — that is
		// minutes of compiling on the WebGL/XR backend and a hitch every time a mesh grows.
		const capacity = Math.ceil(Math.max(n * 1.35, 1100));
		if (p.mesh) {
			this.scene.remove(p.mesh);
			p.mesh.dispose();
		}
		// static usage on purpose: three's WebGPURenderer re-uploads every DynamicDrawUsage
		// attribute on *every* frame (~6 MB/frame for the city); static ones only on needsUpdate
		p.inst = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
		p.geometry.setAttribute('aInst', p.inst);
		const mesh = new InstancedMesh(p.geometry, p.holo ? this.holoMaterial : this.material, capacity);
		mesh.frustumCulled = false;
		mesh.name = `city:${p.name}`;
		if (p.holo) mesh.renderOrder = 10;
		mesh.count = 0;
		this.scene.add(mesh);
		p.mesh = mesh;
		p.capacity = capacity;
	}

	/** Shift the render origin (in whole blocks) to keep coordinates small. Returns the delta. */
	maybeRebase(cameraPos, limit = 1800) {
		if (!Number.isFinite(cameraPos.x + cameraPos.z)) return null; // never poison the origin
		if (Math.abs(cameraPos.x) < limit && Math.abs(cameraPos.z) < limit) return null;
		const P = this.pitch * this.C;
		const delta = new Vector3(Math.round(cameraPos.x / P) * P, 0, Math.round(cameraPos.z / P) * P);
		this.origin.add(delta);
		this.pack();
		return delta;
	}
}
