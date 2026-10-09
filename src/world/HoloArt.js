// 3D holograms: real volumetric pieces instead of flat cards.
//
//   * koi schools circling over intersections, whales cruising above the skyline and
//     torii-gate tunnels spanning the streets (you can fly through them): Geometry Nodes
//     generators from blender/kit.py (X0_Koi, X1_Whale, X2_Torii), drawn as one
//     instanced draw call each; swimming is a travelling wave in the vertex shader
//   * giant animated characters: a running kitsune fox (glTF sample "Fox": model CC0
//     PixelMannen, rig & animation CC-BY 4.0 tomkranis) and a dancing robot
//     ("RobotExpressive", CC0 Tomás Laulhé / Quaternius) projected over street corners
//
// Placement is a pure function of the street grid (deterministic, infinite). Shading:
// additive, fresnel-rimmed, scan-lined, glitching - never writes depth.
import {
	InstancedMesh, MeshBasicNodeMaterial, AdditiveBlending, DoubleSide, InstancedBufferAttribute, Vector3, Color, Box3,
	AnimationMixer, Group,
} from 'three/webgpu';
import {
	attribute, varying, positionGeometry, normalGeometry, vec3, vec4, float, uniform, sin, cos, normalize, cameraPosition, time,
	smoothstep, step, fract, floor, hash, abs, dot, pow, mix, length, exp, positionWorld, normalWorld, max,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { hash2 } from '../city/blenderHash.js';
import { paletteColor } from '../materials/palette.js';
import { additiveMRT } from '../materials/additiveMRT.js';

export const holoArtUniforms = { intensity: uniform(1.0) };
// grid cells around the camera, nearest first (pools fill with the closest pieces)
const R = 7;
const CELLS = [];
for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) CELLS.push([di, dj]);
CELLS.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
const rnd = (i, j, k) => hash2((i * 73856093) ^ (k * 83492791), j * 19349663 + k * 7) / 4294967296;

/** Shared hologram look for a colour node and a world normal / position. */
function holoShade(col, nW, pW, seed) {
	const V = normalize(cameraPosition.sub(pW));
	const fres = pow(float(1).sub(abs(dot(nW, V))), 2.2);
	const scan = smoothstep(0.3, 0.0, abs(fract(pW.y.mul(1.4).sub(time.mul(2.2))).sub(0.5))).mul(0.55).add(0.45);
	const sweep = smoothstep(0.985, 1.0, fract(pW.y.mul(0.012).sub(time.mul(0.25)).add(seed))).mul(3.0);
	const glitch = step(0.94, hash(floor(time.mul(14)).toUint().add(seed.mul(997).toUint()))).mul(0.7);
	const d = length(pW.sub(cameraPosition));
	const fade = smoothstep(4.0, 30.0, d).mul(exp(d.mul(-0.0009)));
	return col.mul(fres.mul(2.2).add(0.06)).mul(scan.add(sweep)).mul(float(1).sub(glitch)).mul(fade).mul(holoArtUniforms.intensity);
}

function baseMaterial() {
	const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
	m.fog = false;
	m.mrtNode = additiveMRT();
	return m;
}

/** Instanced GN piece with per-instance (pos, yaw) / (scale, phase, hue, wave). */
class Swarm {
	constructor(geometry, max, { waveLen = 6.0, waveSpeed = 5.0, pitchWave = 0 } = {}) {
		const geo = geometry.clone();
		this.aP = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
		this.aQ = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
		geo.setAttribute('aP', this.aP);
		geo.setAttribute('aQ', this.aQ);
		const m = baseMaterial();
		const P = attribute('aP', 'vec4'), Q = attribute('aQ', 'vec4');
		const yaw = P.w, scale = Q.x, phase = Q.y, hue = Q.z, wave = Q.w;
		// body wave: lateral (three -Z) swing growing towards the tail (-X), plus a slow vertical undulation
		const p = positionGeometry;
		const tail = smoothstep(0.45, -0.5, p.x);
		const w = sin(p.x.mul(waveLen).sub(time.mul(waveSpeed)).add(phase)).mul(wave).mul(tail.mul(0.85).add(0.15));
		const lp = vec3(p.x, p.y.add(sin(p.x.mul(3.0).sub(time.mul(waveSpeed * 0.5)).add(phase)).mul(wave).mul(pitchWave)), p.z.add(w));
		const c = cos(yaw), s = sin(yaw);
		const rot = (v) => vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
		m.positionNode = rot(lp).mul(scale).add(P.xyz);
		const nW = varying(normalize(rot(normalGeometry)));
		const vHue = varying(hue), vSeed = varying(phase.mul(0.159));
		const col = mix(paletteColor(vHue), vec3(0.7, 1.0, 1.0), 0.18);
		m.colorNode = holoShade(col, nW, positionWorld, vSeed);
		this.mesh = new InstancedMesh(geo, m, max);
		this.mesh.count = 0;
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 13;
		this.max = max;
		this.n = 0;
	}

	begin() { this.n = 0; }

	push(x, y, z, yaw, scale, phase, hue, wave) {
		if (this.n >= this.max) return;
		const k = this.n++ * 4;
		const A = this.aP.array, B = this.aQ.array;
		A[k] = x; A[k + 1] = y; A[k + 2] = z; A[k + 3] = yaw;
		B[k] = scale; B[k + 1] = phase; B[k + 2] = hue; B[k + 3] = wave;
	}

	end() {
		this.mesh.count = this.n;
		this.aP.needsUpdate = true;
		this.aQ.needsUpdate = true;
	}
}

/** Material for skinned glTF characters (skinning handled by the node system). */
function characterMaterial(color) {
	const m = baseMaterial();
	const tint = uniform(new Color(color));
	m.colorNode = holoShade(mix(tint, vec3(0.75, 1.0, 1.0), 0.15), normalWorld, positionWorld, float(0.37));
	return m;
}

export class HoloArt {
	constructor(kit) {
		this.group = new Group();
		this.group.name = 'holo-art';
		this.koi = new Swarm(kit.get('X0_Koi'), 160, { waveLen: 7.0, waveSpeed: 7.0 });
		this.whales = new Swarm(kit.get('X1_Whale'), 6, { waveLen: 3.2, waveSpeed: 1.2, pitchWave: 0.6 });
		this.torii = new Swarm(kit.get('X2_Torii'), 160);
		this.group.add(this.koi.mesh, this.whales.mesh, this.torii.mesh);
		this.chars = []; // { root, mixer, kind }
		this.templates = {};
		this.t = 0;
	}

	async loadCharacters(base = '/assets/holo/') {
		const loader = new GLTFLoader();
		const load = async (file, clipName, height, color, kind) => {
			try {
				const g = await loader.loadAsync(base + file);
				const box = new Box3().setFromObject(g.scene);
				const size = box.getSize(new Vector3());
				const unit = 1 / Math.max(size.y, 1e-6); // normalise to 1 m tall, feet at 0
				g.scene.traverse((o) => {
					if (o.isMesh) { o.material = characterMaterial(color); o.frustumCulled = false; }
				});
				this.templates[kind] = { scene: g.scene, clip: g.animations.find((a) => a.name === clipName) ?? g.animations[0], unit, minY: box.min.y, height };
			} catch (e) {
				console.warn('hologram model failed', file, e);
			}
		};
		await Promise.all([
			load('Fox.glb', 'Run', 26, 0xff5a1e, 'fox'),
			load('RobotExpressive.glb', 'Dance', 70, 0x26d8ff, 'robot'),
		]);
		// a small pool of live instances, re-placed as the camera moves
		for (const [kind, n] of [['fox', 3], ['robot', 2]]) {
			const T = this.templates[kind];
			if (!T) continue;
			for (let i = 0; i < n; i++) {
				const inner = SkeletonUtils.clone(T.scene);
				inner.scale.setScalar(T.unit * T.height);
				inner.position.y = -T.minY * T.unit * T.height;
				const root = new Group();
				root.add(inner);
				root.visible = false;
				const mixer = new AnimationMixer(inner);
				const act = mixer.clipAction(T.clip);
				act.play();
				act.time = Math.random() * T.clip.duration;
				this.group.add(root);
				this.chars.push({ root, mixer, kind, slot: null });
			}
		}
		return this;
	}

	/** Re-place everything around the camera. origin: render origin; absolute = render + origin. */
	update(dt, camera, origin, pitch, streetWidth) {
		this.t += dt;
		const t = this.t;
		const cam = camera.position;
		const ax = cam.x + origin.x, az = cam.z + origin.z;
		const ci = Math.round(ax / pitch), cj = Math.round(-az / pitch);
		this.koi.begin();
		this.whales.begin();
		this.torii.begin();
		const charSlots = { fox: [], robot: [] };
		{
			for (const [di, dj] of CELLS) {
				const i = ci + di, j = cj + dj;
				const X = i * pitch - origin.x, Z = -j * pitch - origin.z; // intersection, render space
				const d2 = (X - cam.x) ** 2 + (Z - cam.z) ** 2;
				// ---- koi school circling the intersection
				if (rnd(i, j, 31) < 0.06) {
					const n = 6 + Math.floor(rnd(i, j, 32) * 8);
					const alt = 45 + rnd(i, j, 33) * 140;
					const radius = 22 + rnd(i, j, 34) * 40;
					const hue = Math.floor(rnd(i, j, 35) * 4);
					const dir = rnd(i, j, 36) < 0.5 ? 1 : -1;
					for (let k = 0; k < n; k++) {
						const sp = 0.1 + rnd(i, j, 40 + k) * 0.05;
						const a = dir * t * sp + k * 0.55 + rnd(i, j, 60 + k) * 0.4;
						const rr = radius * (0.8 + rnd(i, j, 80 + k) * 0.4);
						const x = X + Math.cos(a) * rr, z = Z + Math.sin(a) * rr;
						const y = alt + Math.sin(t * 0.6 + k) * 4 + k * 1.5;
						// heading = tangent of the circle; yaw maps +X to (cos, -sin)
						const yaw = Math.atan2(-Math.cos(a) * dir, -Math.sin(a) * dir);
						this.koi.push(x, y, z, yaw, 9 + rnd(i, j, 100 + k) * 7, k * 1.7 + i, (hue + (k % 3 === 0 ? 1 : 0)) % 4, 0.07);
					}
				}
				// ---- whale cruising along the avenue above the skyline
				if (rnd(i, j, 41) < 0.018) {
					const along = rnd(i, j, 42) < 0.5;
					const span = pitch * 10, speed = 9 + rnd(i, j, 43) * 6;
					const off = ((t * speed + rnd(i, j, 44) * span) % span) - span / 2;
					const x = along ? X + off : X, z = along ? Z : Z - off;
					this.whales.push(x, 260 + rnd(i, j, 45) * 140, z, along ? 0 : Math.PI / 2, 110 + rnd(i, j, 46) * 80, i * 3.1, 1 + Math.floor(rnd(i, j, 47) * 2) * 2, 0.025);
				}
				// ---- torii tunnel over the street leaving this intersection (+X or -Z)
				for (const axis of [0, 1]) {
					if (rnd(i, j, 51 + axis) >= 0.05) continue;
					const n = 4 + Math.floor(rnd(i, j, 53 + axis) * 6);
					const gap = 9 + rnd(i, j, 55 + axis) * 6;
					const start = (pitch - (n - 1) * gap) * 0.5;
					const s = streetWidth * 1.0;
					const hue = rnd(i, j, 57 + axis) < 0.7 ? 3 : 0; // vermilion / magenta
					const y0 = rnd(i, j, 59 + axis) < 0.6 ? 0 : 30 + rnd(i, j, 61 + axis) * 60; // street level or floating
					for (let k = 0; k < n; k++) {
						const o = start + k * gap;
						if (axis === 0) this.torii.push(X + o, y0, Z, Math.PI / 2, s, k * 0.7, hue, 0);
						else this.torii.push(X, y0, Z - o, 0, s, k * 0.7, hue, 0);
					}
				}
				// ---- giant characters at a few street corners
				if (rnd(i, j, 71) < 0.035) charSlots.robot.push({ i, j, X, Z, d2 });
				else if (rnd(i, j, 72) < 0.03) charSlots.fox.push({ i, j, X, Z, d2 });
			}
		}
		this.koi.end();
		this.whales.end();
		this.torii.end();

		// nearest slots get the live animated instances
		for (const kind of ['fox', 'robot']) {
			const slots = charSlots[kind].sort((a, b) => a.d2 - b.d2);
			const live = this.chars.filter((c) => c.kind === kind);
			live.forEach((c, k) => {
				const s = slots[k];
				c.root.visible = !!s;
				if (!s) return;
				if (kind === 'robot') {
					// standing in the intersection, facing down a random avenue
					c.root.position.set(s.X, 0, s.Z);
					c.root.rotation.y = Math.floor(rnd(s.i, s.j, 73) * 4) * Math.PI / 2 + Math.PI / 4;
				} else {
					// running a wide circle above the block
					const a = t * 0.16 + rnd(s.i, s.j, 74) * 6.28, rr = pitch * 0.9;
					c.root.position.set(s.X + Math.cos(a) * rr, 120 + rnd(s.i, s.j, 75) * 90, s.Z + Math.sin(a) * rr);
					c.root.rotation.y = -a; // fox model faces +Z: tangent of the circle
				}
				c.mixer.update(dt);
			});
		}
	}
}
