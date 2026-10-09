// Overhead cables strung across the street canyons, some carrying paper lanterns
// or fairy lights (Kowloon / Shinjuku alley mood). Placement is a pure function
// of the street grid, so it is as infinite as the city; geometry is rebuilt when
// the camera moves a block. Cables are opaque camera-facing ribbons, lights are
// additive sprites - two draw calls in total.
import { BufferGeometry, BufferAttribute, Mesh, MeshBasicNodeMaterial, AdditiveBlending, Vector3 } from 'three/webgpu';
import {
	attribute, positionGeometry, cameraPosition, normalize, cross, vec3, float, uv, length, smoothstep, time, sin, mix, uniform,
	positionWorld, exp, select,
} from 'three/tsl';
import { hash2 } from '../city/blenderHash.js';
import { paletteColor } from '../materials/palette.js';
import { additiveMRT } from '../materials/additiveMRT.js';

const rnd = (i, j, k) => hash2((i * 92837111) ^ (k * 689287499), j * 283923481 + k * 7) / 4294967296;
const SEG = 14;

export const wireUniforms = { lights: uniform(1.0) };

export class Wires {
	constructor(maxWires = 420, maxLights = 6000) {
		this.maxW = maxWires;
		this.maxL = maxLights;
		// ---- cables: ribbon strips (2 verts per sample), billboarded in the vertex shader
		const nv = maxWires * (SEG + 1) * 2;
		this.wPos = new BufferAttribute(new Float32Array(nv * 3), 3);
		this.wTan = new BufferAttribute(new Float32Array(nv * 3), 3);
		this.wSide = new BufferAttribute(new Float32Array(nv), 1);
		const idx = new Uint32Array(maxWires * SEG * 6);
		for (let w = 0; w < maxWires; w++) {
			for (let s = 0; s < SEG; s++) {
				const a = (w * (SEG + 1) + s) * 2;
				idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], (w * SEG + s) * 6);
			}
		}
		const g = new BufferGeometry();
		g.setAttribute('position', this.wPos);
		g.setAttribute('aTan', this.wTan);
		g.setAttribute('aSide', this.wSide);
		g.setIndex(new BufferAttribute(idx, 1));
		const m = new MeshBasicNodeMaterial();
		const tan = attribute('aTan', 'vec3');
		const side = attribute('aSide', 'float');
		const p = positionGeometry;
		const off = normalize(cross(tan, cameraPosition.sub(p))).mul(side).mul(0.045);
		m.positionNode = p.add(off);
		m.colorNode = vec3(0.012, 0.012, 0.016);
		this.cables = new Mesh(g, m);
		this.cables.frustumCulled = false;
		this.cables.name = 'cables';

		// ---- lights: camera-facing glow sprites
		const nl = maxLights * 4;
		this.lPos = new BufferAttribute(new Float32Array(nl * 3), 3);
		this.lData = new BufferAttribute(new Float32Array(nl * 4), 4); // corner.x, corner.y, size, kind/hue
		const lidx = new Uint32Array(maxLights * 6);
		for (let i = 0; i < maxLights; i++) lidx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
		const lg = new BufferGeometry();
		lg.setAttribute('position', this.lPos);
		lg.setAttribute('aData', this.lData);
		lg.setIndex(new BufferAttribute(lidx, 1));
		const lm = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
		lm.mrtNode = additiveMRT();
		lm.fog = false;
		const D = attribute('aData', 'vec4');
		const c = positionGeometry;
		const toCam = normalize(cameraPosition.sub(c));
		const right = normalize(cross(vec3(0, 1, 0), toCam));
		const up = cross(toCam, right);
		lm.positionNode = c.add(right.mul(D.x.mul(D.z))).add(up.mul(D.y.mul(D.z)));
		const r = length(vec3(D.x, D.y, 0));
		const lantern = D.w.lessThan(3.5);
		const core = smoothstep(0.55, 0.15, r);
		const glow = exp(r.mul(r).mul(-6.0)).mul(0.5);
		const sway = sin(time.mul(1.7).add(c.x.mul(0.3)).add(c.z.mul(0.2))).mul(0.12).add(0.88);
		const col = mix(vec3(1.0, 0.85, 0.6), paletteColor(D.w), select(lantern, float(0.85), float(0.15)));
		const d = length(positionWorld.sub(cameraPosition));
		lm.colorNode = col.mul(core.mul(select(lantern, float(3.2), float(6.0))).add(glow)).mul(sway).mul(exp(d.mul(-0.0022))).mul(wireUniforms.lights);
		this.lights = new Mesh(lg, lm);
		this.lights.frustumCulled = false;
		this.lights.renderOrder = 13;
		this.lights.name = 'wire-lights';
		this.last = new Vector3(1e9, 0, 0);
	}

	addTo(scene) { scene.add(this.cables, this.lights); }

	update(camera, origin, pitch, streetWidth, force = false) {
		const cam = camera.position;
		if (!force && cam.distanceToSquared(this.last) < 45 * 45) return;
		this.last.copy(cam);
		const ax = cam.x + origin.x, az = cam.z + origin.z;
		const ci = Math.round(ax / pitch), cj = Math.round(-az / pitch);
		const R = 5, half = streetWidth / 2 + 1.0;
		const P = this.wPos.array, T = this.wTan.array, S = this.wSide.array;
		const LP = this.lPos.array, LD = this.lData.array;
		let w = 0, l = 0;
		const a = new Vector3(), b = new Vector3(), q = new Vector3(), t = new Vector3();
		for (let dj = -R; dj <= R && w < this.maxW; dj++) {
			for (let di = -R; di <= R && w < this.maxW; di++) {
				const i = ci + di, j = cj + dj;
				// two street segments start at each intersection: along X (axis 0) and along Z (axis 1)
				for (let axis = 0; axis < 2; axis++) {
					const n = Math.floor(rnd(i, j, 1 + axis) * 4); // 0..3 spans
					for (let k = 0; k < n && w < this.maxW; k++) {
						const sk = 10 + axis * 20 + k * 3;
						const along = (0.15 + rnd(i, j, sk) * 0.7) * pitch;
						const h = 8 + rnd(i, j, sk + 1) ** 1.6 * 42;
						const sag = 1.5 + rnd(i, j, sk + 2) * 4;
						const x = i * pitch, z = -j * pitch;
						if (axis === 0) { a.set(x + along, h, z - half); b.set(x + along, h + (rnd(i, j, sk + 1) - 0.5) * 4, z + half); }
						else { a.set(x - half, h, z - along); b.set(x + half, h + (rnd(i, j, sk + 1) - 0.5) * 4, z - along); }
						a.sub(origin); b.sub(origin);
						const kind = rnd(i, j, sk + 3); // < .35 lanterns, < .6 fairy lights
						const hue = Math.floor(rnd(i, j, sk + 4) * 4);
						for (let s = 0; s <= SEG; s++) {
							const u = s / SEG;
							q.lerpVectors(a, b, u);
							q.y -= sag * 4 * u * (1 - u);
							t.subVectors(b, a).normalize();
							t.y -= sag * 4 * (1 - 2 * u) / a.distanceTo(b);
							for (let e = 0; e < 2; e++) {
								const v = (w * (SEG + 1) + s) * 2 + e;
								P.set([q.x, q.y, q.z], v * 3);
								T.set([t.x, t.y, t.z], v * 3);
								S[v] = e ? 1 : -1;
							}
						}
						if (kind < 0.6) {
							const lantern = kind < 0.35;
							const span = a.distanceTo(b);
							const count = Math.floor(span / (lantern ? 2.6 : 1.1));
							for (let m = 1; m < count && l < this.maxL; m++) {
								const u = m / count;
								q.lerpVectors(a, b, u);
								q.y -= sag * 4 * u * (1 - u) + (lantern ? 0.7 : 0.05);
								const size = lantern ? 0.55 + rnd(i, j, sk + m) * 0.25 : 0.16;
								const kindHue = lantern ? hue : 4 + hue;
								const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
								for (let cc = 0; cc < 4; cc++) {
									LP.set([q.x, q.y, q.z], (l * 4 + cc) * 3);
									LD.set([corners[cc][0], corners[cc][1], size, kindHue], (l * 4 + cc) * 4);
								}
								l++;
							}
						}
						w++;
					}
				}
			}
		}
		this.cables.geometry.setDrawRange(0, w * SEG * 6);
		this.lights.geometry.setDrawRange(0, l * 6);
		this.wPos.needsUpdate = this.wTan.needsUpdate = this.wSide.needsUpdate = true;
		this.lPos.needsUpdate = this.lData.needsUpdate = true;
	}
}
