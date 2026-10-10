// Branch-skip local lights. three evaluates every light for every lit fragment:
// the car's point / spot lights reach a few metres (cut-off distance, cone) yet
// cost a full BRDF evaluation on every pixel of the city, in both eyes.
// Wrapping each in `if (lightColor != 0)` gives identical pixels (attenuation is
// exactly 0 outside the range) and spatially coherent branches the GPU skips.
import { LightsNode } from 'three/webgpu';
import { If, vec3 } from 'three/tsl';

let installed = false;

export function installLightCulling() {
	if (installed) return;
	installed = true;
	const base = LightsNode.prototype.setupDirectLight;
	LightsNode.prototype.setupDirectLight = function (builder, lightNode, lightData) {
		const light = lightNode.light;
		const { lightingModel, reflectedLight } = builder.context;
		// clearcoat / sheen / iridescence accumulate into extra model state: leave those (the car paint) as they are
		const plain = lightingModel && !lightingModel.clearcoat && !lightingModel.sheen && !lightingModel.iridescence && !lightingModel.anisotropy;
		if (!plain || !(light?.isPointLight || light?.isSpotLight) || !lightData.lightColor || !reflectedLight) {
			return base.call(this, builder, lightNode, lightData);
		}
		// accumulate into locals initialised *outside* the branch (TSL would otherwise
		// emit the accumulators' initialisation inside it), then add them up after
		const c = lightData.lightColor.toVar();
		const dd = vec3(0).toVar(), ds = vec3(0).toVar();
		dd.assign(vec3(0));
		ds.assign(vec3(0));
		If(c.r.add(c.g).add(c.b).greaterThan(0), () => {
			lightingModel.direct({ ...lightData, lightColor: c, lightNode, reflectedLight: { directDiffuse: dd, directSpecular: ds } }, builder);
		});
		reflectedLight.directDiffuse.addAssign(dd);
		reflectedLight.directSpecular.addAssign(ds);
	};
}
