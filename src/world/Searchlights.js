// Sweeping searchlight beams on landmark towers. The city streamer reports where
// the GN layout put landmark spires / holograms; each gets two soft additive
// cones that sweep through the haze, animated entirely on the GPU.
import { InstancedMesh, ConeGeometry, MeshBasicNodeMaterial, AdditiveBlending, InstancedBufferAttribute, DoubleSide, Color } from 'three/webgpu';
import {
	attribute, positionGeometry, normalGeometry, time, vec3, float, sin, cos, normalize, cross, abs, dot, pow, uniform, smoothstep,
	cameraPosition, positionWorld, mix, varying, mx_noise_float,
} from 'three/tsl';
import { additiveMRT } from '../materials/additiveMRT.js';

const MAX = 96;

export const searchUniforms = { intensity: uniform(0.3), color: uniform(new Color(0.75, 0.82, 1.0)) };

export function createSearchlights() {
	// unit cone: apex at the origin, opening along +Y (height 1, radius 1 at the top)
	const geo = new ConeGeometry(1, 1, 32, 1, true).translate(0, -0.5, 0).rotateX(Math.PI);
	const base = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
	geo.setAttribute('aBase', base);
	const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
	m.fog = false;
	m.mrtNode = additiveMRT();
	const b = attribute('aBase', 'vec4');
	const phase = b.w;
	const a = time.mul(0.35).add(phase.mul(6.283));
	const tilt = sin(time.mul(0.23).add(phase.mul(11.0))).mul(0.22).add(0.42);
	const d = normalize(vec3(sin(a).mul(sin(tilt)), cos(tilt), cos(a).mul(sin(tilt))));
	const t1 = normalize(cross(d, vec3(0, 0, 1)));
	const t2 = cross(t1, d);
	const L = float(700), R = float(30);
	const p = positionGeometry; // raw vertex data (positionLocal is overwritten by positionNode)
	m.positionNode = b.xyz.add(t1.mul(p.x.mul(R))).add(d.mul(p.y.mul(L))).add(t2.mul(p.z.mul(R)));
	const nW = varying(normalize(t1.mul(normalGeometry.x).add(d.mul(normalGeometry.y)).add(t2.mul(normalGeometry.z))));
	const along = varying(p.y);
	const V = normalize(cameraPosition.sub(positionWorld));
	const core = pow(abs(dot(nW, V)), 2.5);
	const fall = pow(float(1).sub(along), 1.6).mul(smoothstep(0.0, 0.03, along));
	const dust = mx_noise_float(positionWorld.mul(0.02).add(vec3(0, time.mul(-0.4), 0))).mul(0.35).add(0.75);
	m.colorNode = searchUniforms.color.mul(core).mul(fall).mul(dust).mul(searchUniforms.intensity);
	const mesh = new InstancedMesh(geo, m, MAX);
	mesh.count = 0;
	mesh.frustumCulled = false;
	mesh.renderOrder = 15;
	mesh.name = 'searchlights';
	mesh.userData.base = base;
	return mesh;
}

/** positions: array of {x, y, z} in render space (tops of landmark towers). */
export function setSearchlights(mesh, positions, near = { x: 0, z: 0 }) {
	const A = mesh.userData.base.array;
	let n = 0;
	const sorted = [...positions].sort((a, b) => ((a.x - near.x) ** 2 + (a.z - near.z) ** 2) - ((b.x - near.x) ** 2 + (b.z - near.z) ** 2));
	for (const p of sorted) {
		for (let k = 0; k < 2 && n < Math.min(MAX, 32); k++, n++) {
			A[n * 4] = p.x;
			A[n * 4 + 1] = p.y + 2;
			A[n * 4 + 2] = p.z;
			A[n * 4 + 3] = (p.seed + k * 0.5) % 1;
		}
	}
	mesh.count = n;
	mesh.userData.base.needsUpdate = true;
}
