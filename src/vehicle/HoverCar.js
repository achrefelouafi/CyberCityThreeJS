// The KX-9 Kestrel: Blender GN hover car + runtime materials, lights, exhaust
// plumes and twin light trails.

import {
	Group, Mesh, MeshPhysicalNodeMaterial, MeshBasicNodeMaterial, PointLight, SpotLight, Object3D, Color, ConeGeometry,
	AdditiveBlending, DoubleSide, Quaternion, Vector3, Euler, MathUtils,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
	uniform, vec3, float, time, sin, positionLocal, uv, smoothstep, mx_noise_float, abs, normalWorld, positionWorld,
	cameraPosition, normalize, dot, pow, mix, fract,
} from 'three/tsl';
import { Trail } from './Trail.js';
import { additiveMRT } from '../materials/additiveMRT.js';

export const carUniforms = {
	neon: uniform(new Color(0.0, 0.85, 1.0)),
	neonI: uniform(3.2),
	throttle: uniform(0.5),
	boost: uniform(0),
};

function paint() {
	const m = new MeshPhysicalNodeMaterial();
	m.color = new Color(0.012, 0.010, 0.018);
	m.metalness = 0.85;
	m.roughness = 0.32;
	m.clearcoat = 1.0;
	m.clearcoatRoughness = 0.04;
	m.iridescence = 0.3;
	m.iridescenceIOR = 1.6;
	m.iridescenceThicknessRange = [180, 520];
	// subtle metallic flake
	const flake = mx_noise_float(positionLocal.mul(160.0)).mul(0.5).add(0.5);
	m.roughnessNode = mix(float(0.13), float(0.24), flake);
	return m;
}

export class HoverCar {
	setEnvironment(tex) {
		for (const k of ['CC_CarPaint', 'CC_CarGlass', 'CC_CarTrim']) {
			const m = this.materials[k];
			m.envMap = tex;
			m.envMapIntensity = k === 'CC_CarPaint' ? 1.0 : 0.8;
			m.needsUpdate = true;
		}
	}

	async load(url) {
		const gltf = await new GLTFLoader().loadAsync(url);
		this.root = new Group();
		this.root.name = 'Kestrel';
		this.body = new Group(); // rotated by bank / pitch
		this.root.add(this.body);
		const model = gltf.scene;
		const mats = {
			CC_CarPaint: paint(),
			CC_CarGlass: Object.assign(new MeshPhysicalNodeMaterial(), { color: new Color(0.004, 0.006, 0.012), metalness: 0.2, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.0 }),
			CC_CarTrim: Object.assign(new MeshPhysicalNodeMaterial(), { color: new Color(0.008, 0.008, 0.01), metalness: 0.5, roughness: 0.55 }),
			CC_CarNeon: new MeshBasicNodeMaterial(),
			CC_HeadLight: new MeshBasicNodeMaterial(),
			CC_TailLight: new MeshBasicNodeMaterial(),
			CC_Thruster: new MeshBasicNodeMaterial(),
		};
		const pulse = sin(time.mul(2.4)).mul(0.15).add(0.85);
		mats.CC_CarNeon.colorNode = carUniforms.neon.mul(carUniforms.neonI).mul(pulse);
		mats.CC_HeadLight.colorNode = vec3(0.8, 0.92, 1.0).mul(9);
		mats.CC_TailLight.colorNode = vec3(1.0, 0.02, 0.16).mul(8);
		const flick = mx_noise_float(vec3(time.mul(18), 0, 0)).mul(0.25).add(0.85);
		mats.CC_Thruster.colorNode = mix(vec3(0.3, 0.7, 1.0), vec3(1.0, 0.3, 0.9), carUniforms.boost).mul(carUniforms.throttle.mul(2.5).add(1.5)).mul(flick);
		// cockpit glow seen through the canopy
		const V = normalize(cameraPosition.sub(positionWorld));
		const fres = pow(float(1).sub(abs(dot(normalWorld, V))), 3.0);
		mats.CC_CarGlass.emissiveNode = carUniforms.neon.mul(0.06).add(vec3(0.05, 0.1, 0.2).mul(fres));

		model.traverse((o) => {
			if (o.isMesh) {
				o.material = mats[o.material.name] ?? o.material;
				o.frustumCulled = false;
			}
		});
		this.body.add(model);
		this.materials = mats;

		// ------------------------------------------------------------ lights
		this.under = new PointLight(0x18d6ff, 30, 50, 2);
		this.under.position.set(0, -6, 0);
		this.body.add(this.under);
		this.tailLight = new PointLight(0xff2050, 14, 25, 2);
		this.tailLight.position.set(-4.5, 0.9, 0);
		this.body.add(this.tailLight);
		this.headTarget = new Object3D();
		this.headTarget.position.set(40, -6, 0);
		this.body.add(this.headTarget);
		this.head = new SpotLight(0xdbe9ff, 4500, 260, 0.32, 0.55, 2);
		this.head.position.set(2.7, 0.9, 0);
		this.head.target = this.headTarget;
		this.body.add(this.head);

		// ------------------------------------------------------------ exhaust plumes
		const plumeMat = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
		plumeMat.mrtNode = additiveMRT();
		const v = uv().y; // 0 at base -> 1 at tip (cone is rotated so tip points back)
		const n = mx_noise_float(vec3(positionLocal.y.mul(3).add(time.mul(-40)), positionLocal.x.mul(4), time.mul(5))).mul(0.5).add(0.5);
		plumeMat.colorNode = mix(vec3(0.4, 0.75, 1.0), vec3(1.0, 0.25, 0.85), carUniforms.boost).mul(smoothstep(0.0, 0.9, v)).mul(n.add(0.3)).mul(carUniforms.throttle.mul(5).add(1.5));
		this.plumes = [];
		for (const side of [1, -1]) {
			const cone = new Mesh(new ConeGeometry(0.17, 2.4, 16, 1, true).translate(0, -1.2, 0).rotateZ(Math.PI / 2), plumeMat);
			cone.position.set(-2.62, 0.38 + 1.22 * 0.36, side * 2.25 * 0.22);
			cone.frustumCulled = false;
			this.body.add(cone);
			this.plumes.push(cone);
		}

		// ------------------------------------------------------------ light trails from the wing tips
		this.trails = [
			new Trail({ color: new Color(0.0, 0.85, 1.0), width: 0.06, length: 48 }),
			new Trail({ color: new Color(1.0, 0.1, 0.55), width: 0.06, length: 48 }),
		];
		this.trailAnchors = [new Vector3(-2.75, 1.47, 1.18), new Vector3(-2.75, 1.47, -1.18)];
		return this;
	}

	addTo(scene) {
		scene.add(this.root);
		for (const t of this.trails) scene.add(t.mesh);
	}

	/** Pose the car from the autopilot state (render-space position). */
	update(dt, ap, renderPos, camera) {
		this.root.position.copy(renderPos);
		const yaw = Math.atan2(-ap.forward.z, ap.forward.x);
		this.root.rotation.set(0, yaw, 0);
		const hover = Math.sin(performance.now() * 0.0021) * 0.06;
		this.body.position.y = hover;
		this.body.rotation.set(ap.bank, 0, ap.pitch, 'YXZ');
		const thr = MathUtils.clamp(ap.speed / 60, 0.2, 1.4);
		carUniforms.throttle.value = MathUtils.damp(carUniforms.throttle.value, thr, 4, dt);
		carUniforms.boost.value = MathUtils.damp(carUniforms.boost.value, ap.boost, 3, dt);
		for (const p of this.plumes) p.scale.set(0.6 + thr * 0.9 + ap.boost * 0.8, 1, 1);
		// slide the reflection environment with distance travelled (passing-lights effect)
		for (const k of ['CC_CarPaint', 'CC_CarGlass']) {
			const m = this.materials[k];
			if (m.envMapRotation) m.envMapRotation.y = -ap.distance * 0.018;
		}
		this.root.updateMatrixWorld(true);
		const tmp = new Vector3();
		this.trails.forEach((t, i) => {
			tmp.copy(this.trailAnchors[i]);
			this.body.localToWorld(tmp);
			t.push(tmp, camera, dt);
		});
	}

	rebase(delta) {
		for (const t of this.trails) t.shift(delta);
	}
}
