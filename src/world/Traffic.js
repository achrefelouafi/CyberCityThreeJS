// GPU-driven flying traffic. No per-car CPU work at all: every instance derives
// its lane, altitude, speed and position along an infinite periodic street from
// instanceIndex + time in the vertex shader. Cars live in absolute world space
// (period = window size), so they stream past consistently while the camera
// moves, and their custom motion vectors make head/tail lights streak.

import { InstancedMesh, MeshStandardNodeMaterial, Vector3, Vector2 } from 'three/webgpu';
import {
	Fn, uniform, instanceIndex, positionLocal, normalLocal, vec3, vec4, vec2, float, int, floor, fract, mod, select, hash,
	round, attribute, mix, time, deltaTime, positionWorld, cameraProjectionMatrix, cameraViewMatrix, mrt, step, sin, varying,
} from 'three/tsl';
import { paletteColor } from '../materials/palette.js';
import { prevViewProj } from '../materials/velocity.js';
import { archUniforms } from '../materials/ArchitectureMaterial.js';

const STREETS = 18, LANES = 8, CARS = 9; // lanes: 2 directions x (street level + 3 sky levels)

export const trafficUniforms = {
	camCell: uniform(new Vector2()), // camera street indices (i along x, j along blender y)
	camAbs: uniform(new Vector3()), // absolute camera position (three space)
	pitch: uniform(86),
	speed: uniform(1.0),
	lights: uniform(1.0),
};

export function createTraffic(geometry) {
	const U = trafficUniforms;
	const N = 2 * STREETS * LANES * CARS;
	const mat = new MeshStandardNodeMaterial();

	const h = (k) => hash(instanceIndex.toUint().mul(9781).add(k));
	const laneId = instanceIndex.div(CARS);
	const carK = instanceIndex.mod(CARS);
	const lane = laneId.mod(LANES);
	const street = laneId.div(LANES).mod(STREETS);
	const axis = laneId.div(LANES * STREETS); // 0: drives along X, 1: drives along Z
	const hl = (k) => hash(laneId.toUint().mul(7919).add(k));

	const dir = select(lane.mod(2).equal(0), float(1), float(-1));
	const level = lane.div(2).toFloat();
	const ground = level.lessThan(0.5);
	const alt = select(ground, float(0.75), level.sub(1).mul(34).add(30).add(hl(3).mul(10)));
	const L = U.pitch.mul(STREETS);
	const v = select(ground, hl(5).mul(6).add(11), hl(5).mul(22).add(30)).mul(U.speed).mul(h(7).mul(0.25).add(0.88));
	// street index around the camera
	const camIdx = select(axis.equal(0), U.camCell.y, U.camCell.x);
	const sIdx = floor(camIdx).add(street.toFloat()).sub(STREETS / 2);
	const lateral = select(ground, dir.mul(select(hl(23).greaterThan(0.5), float(3.2), float(7.0))), dir.mul(3.2).add(level.sub(2).mul(1.2)));
	// periodic absolute position along the street, nearest copy to the camera
	const camAlong = select(axis.equal(0), U.camAbs.x, U.camAbs.z);
	const phase = carK.toFloat().add(h(11).mul(0.7)).div(CARS).add(hl(13));
	const along0 = fract(phase.add(time.mul(v).mul(dir).div(L))).mul(L);
	const along = along0.add(round(camAlong.sub(along0).div(L)).mul(L));
	// three-space absolute: axis 0 -> street at z = -j*pitch ; axis 1 -> street at x = i*pitch
	const across = select(axis.equal(0), sIdx.negate().mul(U.pitch), sIdx.mul(U.pitch));
	const absPos = select(axis.equal(0), vec3(along, alt, across.add(lateral)), vec3(across.add(lateral), alt, along));
	const fwd = select(axis.equal(0), vec3(dir, 0, 0), vec3(0, 0, dir));
	// rotate the car (faces +X) so +X -> fwd ; right = fwd x up
	const scale = select(h(17).lessThan(0.12), float(1.7), float(1.0));
	const p = positionLocal.mul(scale);
	const right = vec3(fwd.z.negate(), 0, fwd.x);
	const local = fwd.mul(p.x).add(vec3(0, p.y, 0)).add(right.mul(p.z.negate()));
	const world = absPos.sub(archUniforms.origin).add(local);
	mat.positionNode = world;
	const vMotion = varying(fwd.mul(v)); // per-car velocity (m/s), for motion vectors

	// shading by Blender material role (V1_Traffic: paint 10, glass 11, neon 12, head 13, tail 14)
	const role = attribute('aRole', 'float');
	const hue = varying(floor(h(19).mul(4)));
	const neon = paletteColor(hue);
	mat.colorNode = select(role.lessThan(10.5), vec3(0.02, 0.02, 0.025), vec3(0.01));
	mat.metalnessNode = float(0.8);
	mat.roughnessNode = select(role.lessThan(10.5), float(0.35), float(0.05));
	const head = vec3(0.85, 0.92, 1.0).mul(26);
	const tail = vec3(1.0, 0.04, 0.12).mul(20);
	mat.emissiveNode = select(role.greaterThan(13.5), tail, select(role.greaterThan(12.5), head, select(role.greaterThan(11.5), neon.mul(6), vec3(0))))
		.mul(U.lights);

	// motion vectors include the car's own motion -> light streaks under motion blur
	const vel = Fn(() => {
		const wp = vec4(positionWorld, 1); // mesh is at the origin with identity instances: local == world
		const prevWorld = vec4(wp.xyz.sub(vMotion.mul(deltaTime)), 1);
		const curr = cameraProjectionMatrix.mul(cameraViewMatrix).mul(wp);
		const prev = prevViewProj.mul(prevWorld);
		return curr.xy.div(curr.w).sub(prev.xy.div(prev.w));
	})();
	mat.mrtNode = mrt({ velocity: vel });

	const mesh = new InstancedMesh(geometry, mat, N);
	mesh.frustumCulled = false;
	mesh.name = 'traffic';
	return mesh;
}

export function updateTraffic(camera, origin, pitch) {
	const U = trafficUniforms;
	U.camAbs.value.set(camera.position.x + origin.x, camera.position.y, camera.position.z + origin.z);
	U.camCell.value.set(Math.round(U.camAbs.value.x / pitch), Math.round(-U.camAbs.value.z / pitch));
	U.pitch.value = pitch;
}
