// The KX-11 Kestrel: procedural Blender hover sedan (blender/car.py) + runtime
// materials, live cockpit screens, lights, exhaust plumes and twin light trails.
// Mount points (eye, nozzles, trails, lamps) come from the glTF node extras.

import {
	Group, Mesh, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, MeshBasicNodeMaterial, PointLight, SpotLight, Object3D, Color,
	ConeGeometry, AdditiveBlending, DoubleSide, Vector3, MathUtils,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
	uniform, vec3, float, time, sin, positionLocal, uv, smoothstep, mx_noise_float, abs, normalWorld, positionWorld,
	cameraPosition, normalize, dot, pow, mix, fract, texture, clamp, max,
} from 'three/tsl';
import { Trail } from './Trail.js';
import { CockpitScreens } from './CockpitScreens.js';
import { additiveMRT } from '../materials/additiveMRT.js';

export const carUniforms = {
	neon: uniform(new Color(0.0, 0.85, 1.0)),
	neonI: uniform(3.2),
	throttle: uniform(0.5),
	boost: uniform(0),
	brake: uniform(0),
	inside: uniform(0), // 1 in the cockpit view: glass fades so the city reads through it
	paint: uniform(new Color(0.034, 0.008, 0.028)),
};

const fresnel = (p = 3) => pow(float(1).sub(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld))))), p);

function paint() {
	const m = new MeshPhysicalNodeMaterial();
	m.colorNode = carUniforms.paint;
	m.metalness = 0.72;
	m.clearcoat = 1.0;
	m.clearcoatRoughness = 0.03;
	m.iridescence = 0.55;
	m.iridescenceIOR = 1.5;
	m.iridescenceThicknessRange = [220, 640];
	// metallic flake
	const flake = mx_noise_float(positionLocal.mul(180.0)).mul(0.5).add(0.5);
	m.roughnessNode = mix(float(0.16), float(0.3), flake);
	return m;
}

function glass() {
	const m = new MeshPhysicalNodeMaterial({ transparent: true, side: DoubleSide, depthWrite: false });
	m.color = new Color(0.01, 0.05, 0.06);
	m.metalness = 0.1;
	m.roughness = 0.04;
	m.clearcoat = 1;
	m.clearcoatRoughness = 0;
	// tinted canopy: dark and mirror-like at grazing angles, clear when looking through it
	const f = fresnel(2.5);
	m.opacityNode = mix(mix(float(0.42), float(0.92), f), mix(float(0.07), float(0.5), f), carUniforms.inside);
	m.emissiveNode = vec3(0.0, 0.1, 0.14).mul(f).mul(0.4);
	return m;
}

function seat() {
	const m = new MeshStandardNodeMaterial();
	// quilted diamond stitching from object-space position
	const p = positionLocal.mul(22);
	const q = abs(fract(p.x.add(p.y)).sub(0.5)).min(abs(fract(p.x.sub(p.y)).sub(0.5)));
	const stitch = smoothstep(0.0, 0.06, q);
	m.colorNode = mix(vec3(0.004, 0.003, 0.004), vec3(0.035, 0.012, 0.022), stitch);
	m.roughnessNode = mix(float(0.8), float(0.45), stitch);
	m.metalness = 0;
	return m;
}

export class HoverCar {
	setEnvironment(tex) {
		for (const k of ['CC_CarPaint', 'CC_CarGlass', 'CC_CarTrim', 'CC_CarChrome', 'CC_CarInterior']) {
			const m = this.materials[k];
			m.envMap = tex;
			// the cabin must not mirror the bright exterior studio environment
			m.envMapIntensity = { CC_CarPaint: 1.0, CC_CarChrome: 0.9, CC_CarInterior: 0.12 }[k] ?? 0.8;
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
		let A = null;
		model.traverse((o) => { if (!A && o.userData?.anchors) A = JSON.parse(o.userData.anchors); });
		A ??= {
			eye: [-0.5, 1.17, -0.4], nozzles: [[-3.02, 0.8, -1.16], [-3.02, 0.8, 1.16]], trails: [[-2.78, 1.06, -1.16], [-2.78, 1.06, 1.16]],
			head: [2.8, 0.64, 0], tail: [-2.9, 0.86, 0], cabin: [0, 1.15, 0],
		};
		const V = (a) => new Vector3(...a);
		this.anchors = A;
		this.eye = V(A.eye);

		this.screens = new CockpitScreens(A.screenAtlas);
		const mats = {
			CC_CarPaint: paint(),
			CC_CarGlass: glass(),
			CC_CarTrim: Object.assign(new MeshPhysicalNodeMaterial(), { color: new Color(0.01, 0.01, 0.012), metalness: 0.5, roughness: 0.5 }),
			CC_CarChrome: Object.assign(new MeshPhysicalNodeMaterial(), { color: new Color(0.75, 0.74, 0.8), metalness: 1.0, roughness: 0.12 }),
			CC_CarInterior: Object.assign(new MeshPhysicalNodeMaterial(), { color: new Color(0.012, 0.011, 0.014), metalness: 0.0, roughness: 0.75 }),
			CC_CarSeat: seat(),
			CC_CarScreen: new MeshBasicNodeMaterial(),
			CC_CarMarker: new MeshBasicNodeMaterial(),
			CC_CarNeon: new MeshBasicNodeMaterial(),
			CC_HeadLight: new MeshBasicNodeMaterial(),
			CC_TailLight: new MeshBasicNodeMaterial(),
			CC_Thruster: new MeshBasicNodeMaterial(),
		};
		// thin emissive parts are single quads / ribbons: render both sides
		for (const k of ['CC_CarScreen', 'CC_CarMarker', 'CC_CarNeon', 'CC_HeadLight', 'CC_TailLight', 'CC_Thruster']) mats[k].side = DoubleSide;
		const pulse = sin(time.mul(2.4)).mul(0.15).add(0.85);
		// ambient strips inside the cabin glow softer than the exterior neon
		const P = positionLocal;
		const inCabin = smoothstep(0.9, 0.8, abs(P.z)).mul(smoothstep(0.42, 0.5, P.y)).mul(smoothstep(1.28, 1.2, P.y)).mul(smoothstep(-1.35, -1.25, P.x)).mul(smoothstep(1.25, 1.15, P.x));
		mats.CC_CarNeon.colorNode = carUniforms.neon.mul(carUniforms.neonI).mul(pulse).mul(mix(float(1), float(0.14), inCabin));
		mats.CC_HeadLight.colorNode = vec3(0.8, 0.92, 1.0).mul(9);
		mats.CC_TailLight.colorNode = vec3(1.0, 0.02, 0.16).mul(carUniforms.brake.mul(9).add(3));
		mats.CC_CarMarker.colorNode = vec3(1.0, 0.42, 0.05).mul(6);
		const flick = mx_noise_float(vec3(time.mul(18), 0, 0)).mul(0.25).add(0.85);
		mats.CC_Thruster.colorNode = mix(vec3(0.3, 0.7, 1.0), vec3(1.0, 0.3, 0.9), carUniforms.boost).mul(carUniforms.throttle.mul(2.5).add(1.5)).mul(flick);
		// screens: live canvas, slight LED grid, dimmer from outside so they don't bloom through the glass
		const tex = texture(this.screens.texture, uv());
		mats.CC_CarScreen.colorNode = tex.rgb.mul(mix(float(0.9), float(1.6), carUniforms.inside));

		model.traverse((o) => {
			if (o.isMesh) {
				o.material = mats[o.material.name] ?? o.material;
				o.frustumCulled = false;
				if (o.material === mats.CC_CarGlass) o.renderOrder = 5;
			}
		});
		this.body.add(model);
		this.materials = mats;

		// ------------------------------------------------------------ lights
		this.under = new PointLight(0x18d6ff, 30, 50, 2);
		this.under.position.set(0, -2, 0);
		this.body.add(this.under);
		this.tailLight = new PointLight(0xff2050, 14, 25, 2);
		this.tailLight.position.copy(V(A.tail)).add(new Vector3(-0.4, 0, 0));
		this.body.add(this.tailLight);
		this.cabinLight = new PointLight(0x5fc8ff, 0.25, 2.6, 2); // dash glow spilling over the cabin
		this.cabinLight.position.copy(V(A.cabin)).add(new Vector3(0.35, 0.12, 0));
		this.body.add(this.cabinLight);
		this.headTarget = new Object3D();
		this.headTarget.position.set(40, -6, 0);
		this.body.add(this.headTarget);
		this.head = new SpotLight(0xdbe9ff, 4500, 260, 0.32, 0.55, 2);
		this.head.position.copy(V(A.head)).add(new Vector3(0.1, 0, 0));
		this.head.target = this.headTarget;
		this.body.add(this.head);

		// ------------------------------------------------------------ exhaust plumes
		const plumeMat = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
		plumeMat.mrtNode = additiveMRT();
		const v = uv().y; // 0 at base -> 1 at tip (cone is rotated so tip points back)
		const n = mx_noise_float(vec3(positionLocal.y.mul(3).add(time.mul(-40)), positionLocal.x.mul(4), time.mul(5))).mul(0.5).add(0.5);
		plumeMat.colorNode = mix(vec3(0.4, 0.75, 1.0), vec3(1.0, 0.25, 0.85), carUniforms.boost).mul(smoothstep(0.0, 0.9, v)).mul(n.add(0.3)).mul(carUniforms.throttle.mul(5).add(1.5));
		this.plumes = [];
		for (const p of A.nozzles) {
			const cone = new Mesh(new ConeGeometry(0.13, 2.4, 16, 1, true).translate(0, -1.2, 0).rotateZ(Math.PI / 2), plumeMat);
			cone.position.copy(V(p));
			cone.frustumCulled = false;
			this.body.add(cone);
			this.plumes.push(cone);
		}

		// ------------------------------------------------------------ light trails from the nacelles
		this.trails = [
			new Trail({ color: new Color(0.0, 0.85, 1.0), width: 0.06, length: 48 }),
			new Trail({ color: new Color(1.0, 0.1, 0.55), width: 0.06, length: 48 }),
		];
		this.trailAnchors = A.trails.map(V);
		this._lastSpeed = 0;
		return this;
	}

	addTo(scene) {
		scene.add(this.root);
		for (const t of this.trails) scene.add(t.mesh);
	}

	/** Pose the car from the autopilot / player state (render-space position). */
	update(dt, ap, renderPos, camera) {
		this.root.position.copy(renderPos);
		const yaw = Math.atan2(-ap.forward.z, ap.forward.x);
		this.root.rotation.set(0, yaw, 0);
		const hover = Math.sin(performance.now() * 0.0021) * 0.06;
		// comfort (VR cockpit): scale how much of the bank / pitch / bob reaches the cabin
		const k = this.comfort ?? 1;
		this.body.position.y = hover * k;
		this.body.rotation.set(ap.bank * k, 0, ap.pitch * k, 'YXZ');
		const thr = MathUtils.clamp(ap.speed / 60, 0.2, 1.4);
		carUniforms.throttle.value = MathUtils.damp(carUniforms.throttle.value, thr, 4, dt);
		carUniforms.boost.value = MathUtils.damp(carUniforms.boost.value, ap.boost, 3, dt);
		const decel = (this._lastSpeed - ap.speed) / Math.max(dt, 1e-3);
		this._lastSpeed = ap.speed;
		carUniforms.brake.value = MathUtils.damp(carUniforms.brake.value, decel > 6 ? 1 : 0, 8, dt);
		for (const p of this.plumes) p.scale.set(0.6 + thr * 0.9 + ap.boost * 0.8, 1, 1);
		// slide the reflection environment with distance travelled (passing-lights effect)
		for (const k of ['CC_CarPaint', 'CC_CarGlass', 'CC_CarChrome']) {
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

	/** Feed the dashboard displays (call once per frame). */
	updateScreens(dt, state) {
		this.screens.update(dt, state);
	}

	rebase(delta) {
		for (const t of this.trails) t.shift(delta);
	}
}
