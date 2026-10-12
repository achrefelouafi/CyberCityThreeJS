// TSL post-processing stack (WebGPU RenderPipeline):
//
//   scene pass (MRT: colour + motion vectors)
//     -> camera motion blur
//     -> + bloom (mip-chain) + anamorphic streaks (thresholded, horizontal-only blur)
//     -> chromatic aberration
//     -> exposure / filmic tone map / sRGB          (manual renderOutput)
//     -> grade: contrast, saturation, split-tone shadows/highlights
//     -> SMAA | FXAA | off -> sharpen -> vignette + film grain
//
// Structural options (AA mode, depth of field, sharpen, lite) live in `opts`; changing one
// calls rebuild(). Everything else is a uniform and can be tweaked live.
// `lite` (constructor option, fixed for the session) is the phone profile: the scene pass
// writes only colour + motion vectors (tile GPUs pay for every MRT target in bandwidth;
// materials' extra outputs are skipped by three), no SSR, one bloom chain doing the haze
// too, a shorter motion blur, and no DOF / sharpen.

import { RenderPipeline, Color, ACESFilmicToneMapping, SRGBColorSpace, CanvasTexture } from 'three/webgpu';
import {
	pass, mrt, output, velocity, uniform, step, vec2, vec3, vec4, float, int, max, mix, dot, smoothstep, length, uv, renderOutput,
	time, hash, screenCoordinate, min, texture, luminance, clamp, pow, select, Fn, normalView, convertToTexture, screenSize, mx_fractal_noise_float, abs,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { prevViewProjRot, invViewProjRot, updateCameraRotation } from '../materials/velocity.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';

let _dirt = null;
/** Soft smudges + a few streaks drawn on a canvas: a cheap, art-directable lens dirt mask. */
function lensDirtTexture() {
	if (_dirt) return _dirt;
	const c = document.createElement('canvas');
	c.width = 1024;
	c.height = 576;
	const g = c.getContext('2d');
	g.fillStyle = '#000';
	g.fillRect(0, 0, c.width, c.height);
	let s = 1337;
	const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
	g.filter = 'blur(10px)';
	for (let i = 0; i < 70; i++) {
		const x = r() * c.width, y = r() * c.height, rad = 12 + r() ** 2 * 140;
		const gr = g.createRadialGradient(x, y, 0, x, y, rad);
		const a = 0.08 + r() * 0.35;
		gr.addColorStop(0, `rgba(255,255,255,${a})`);
		gr.addColorStop(0.6, `rgba(255,255,255,${a * 0.5})`);
		gr.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = gr;
		g.beginPath();
		g.arc(x, y, rad, 0, Math.PI * 2);
		g.fill();
	}
	g.filter = 'blur(3px)';
	g.strokeStyle = 'rgba(255,255,255,0.18)';
	for (let i = 0; i < 14; i++) {
		g.lineWidth = 1 + r() * 3;
		g.beginPath();
		const x = r() * c.width, y = r() * c.height;
		g.moveTo(x, y);
		g.bezierCurveTo(x + r() * 200 - 100, y + r() * 120 - 60, x + r() * 300 - 150, y + r() * 160 - 80, x + r() * 400 - 200, y + r() * 200 - 100);
		g.stroke();
	}
	_dirt = new CanvasTexture(c);
	return _dirt;
}

export class Post {
	constructor(renderer, scene, camera, titleTexture = null, { lite = false } = {}) {
		this.titleTexture = titleTexture;
		this.renderer = renderer;
		this.u = {
			motionBlur: uniform(0.3),
			turnBlur: uniform(0.15),
			maxBlur: uniform(0.03),
			shutter: uniform(1),
			ssr: uniform(1.8),
			haze: uniform(0.35),
			dofAmount: uniform(0),
			dofFocus: uniform(10),
			dofRange: uniform(9),
			lensDirt: uniform(0.55),
			letterbox: uniform(0),
			title: uniform(0),
			titleScale: uniform(1),
			bloomMix: uniform(1.0),
			anamorphic: uniform(0.3),
			anaThreshold: uniform(3.0),
			anaTint: uniform(new Color(0.35, 0.55, 1.0)),
			ca: uniform(0.12),
			contrast: uniform(1.12),
			saturation: uniform(1.18),
			shadows: uniform(new Color(0.42, 0.3, 0.75)),
			highlights: uniform(new Color(1.0, 0.82, 0.9)),
			splitAmount: uniform(0.45),
			vignette: uniform(0.42),
			grain: uniform(0.035),
			sharpen: uniform(0.35),
			fade: uniform(1.0),
		};
		this.lite = lite;
		this.opts = { aa: 'SMAA', dof: !lite, sharpen: !lite };
		this._tail = []; // passes owned by the current graph, disposed on rebuild
		this.pipeline = new RenderPipeline(renderer);
		this.pipeline.outputColorTransform = false;
		this.scenePass = pass(scene, camera);
		// MRT: beauty, motion vectors, view normals and a reflect mask (wet asphalt writes it)
		this.scenePass.setMRT(lite ? mrt({ output, velocity }) : mrt({ output, velocity, normal: normalView, reflect: vec2(0, 1) }));
		this.buildPasses();
		this.build();
	}

	/** Passes created once (their uniforms are bound to GUI controls). */
	buildPasses() {
		const U = this.u;
		const color = this.color = this.scenePass.getTextureNode('output');
		this.bloom = bloom(color, 0.55, 0.38, 1.15);
		const viewZ = this.scenePass.getViewZNode();
		const far = smoothstep(30.0, 600.0, viewZ.negate());
		const smudge = texture(lensDirtTexture(), uv()).r;
		this._streaks(color);
		if (this.lite) {
			// the main bloom stands in for the wide haze bloom
			this.wet = color;
			this.hazeGlow = this.bloom.rgb.mul(far).mul(U.haze.mul(1.6));
			this.dirt = this.bloom.rgb.mul(1.3).mul(smudge).mul(U.lensDirt);
			return;
		}
		const refl = this.scenePass.getTextureNode('reflect');

		// screen-space reflections on the wet streets (half res, roughness-blurred)
		this.ssr = ssr(color, this.scenePass.getTextureNode('depth'), this.scenePass.getTextureNode('normal'), {
			metalnessNode: refl.r, roughnessNode: refl.g, camera: this.scenePass.camera,
		});
		this.ssr.resolutionScale = 0.5;
		this.ssr.maxDistance.value = 160;
		this.ssr.thickness.value = 1.2;
		this.ssr.quality.value = 0.4;
		this.wet = convertToTexture(vec4(color.rgb.add(this.ssr.rgb.mul(refl.r).mul(U.ssr)), 1));

		// atmospheric glow: a second, very wide bloom weighted by distance, so neon
		// light scatters into the haze of the far canyon (cheap volumetric impression)
		this.haze = bloom(color, 1.0, 1.0, 0.35);
		this.hazeGlow = this.haze.rgb.mul(far).mul(U.haze); // only distant light scatters into the haze

		// lens dirt (baked once to a texture), lit only where the bloom is
		this.dirt = this.haze.rgb.mul(0.5).add(this.bloom.rgb).mul(smudge).mul(U.lensDirt);
	}

	_streaks(color) {
		const U = this.u;
		// anamorphic streaks: bright pass -> two widening horizontal blurs at 1/4 res
		const bright = max(color.rgb.sub(U.anaThreshold), vec3(0)).mul(0.5);
		const s1 = gaussianBlur(vec4(bright, 1), vec2(2.5, 0), 10, { resolutionScale: 0.25 });
		const s2 = gaussianBlur(s1, vec2(7.0, 0), 10, { resolutionScale: 0.25 });
		this.streaks = s1.rgb.mul(0.4).add(s2.rgb).mul(U.anaTint).mul(U.anamorphic);
	}

	/** (Re)assemble the graph from the current `opts`. */
	build() {
		const U = this.u, o = this.opts;
		for (const n of this._tail) n.dispose?.();
		this._tail = [];
		const own = (n) => (this._tail.push(n), n);
		const vel = this.scenePass.getTextureNode('velocity');

		// camera motion blur. Velocity is a per-frame NDC delta. Split off the part caused by
		// the camera *turning* (reproject this pixel's view ray with last frame's rotation):
		// fast mouse-look would otherwise smear the whole frame, sky included.
		const ndc = vec2(uv().x.mul(2).sub(1), float(1).sub(uv().y.mul(2)));
		const ray = invViewProjRot.mul(vec4(ndc, 0.5, 1));
		const prevClip = prevViewProjRot.mul(vec4(ray.xyz.div(ray.w), 1));
		const turnVel = ndc.sub(prevClip.xy.div(prevClip.w)).mul(step(1e-4, prevClip.w));
		// shutter: normalise to a 60 fps frame so low frame rates don't lengthen the streaks
		const v = vel.xy.sub(turnVel.mul(float(1).sub(U.turnBlur))).mul(vec2(0.5, -0.5)).mul(U.motionBlur).mul(U.shutter);
		const vLen = length(v);
		const vClamped = v.mul(min(float(1), U.maxBlur.div(max(vLen, 1e-5)))); // cap streak length (UV)
		const moved = motionBlur(this.wet, vClamped, int(this.lite ? 5 : 10));
		// cinematic depth of field (driven per shot by the director: focus on the car).
		// The DOF composite swaps out-of-focus pixels for its half-res blur even at bokeh 0,
		// so it is faded out entirely whenever the amount is zero (driving, wide shots).
		let blurred = moved;
		if (o.dof) {
			const d = own(dof(moved, this.scenePass.getViewZNode(), U.dofFocus, U.dofRange, U.dofAmount));
			blurred = mix(moved, d, clamp(U.dofAmount.mul(2), 0, 1));
		}

		const hdr = vec4(blurred.rgb.add(this.bloom.rgb.mul(U.bloomMix)).add(this.streaks).add(this.hazeGlow).add(this.dirt), 1);
		const aberrated = chromaticAberration(hdr, U.ca, vec2(0.5, 0.5), 1.08); // r186: center=null is not handled

		// tone map + sRGB, then grade in display space
		const ldr = renderOutput(aberrated, ACESFilmicToneMapping, SRGBColorSpace);
		const graded = Fn(() => {
			const c = ldr.rgb.toVar();
			c.assign(c.sub(0.5).mul(U.contrast).add(0.5));
			const l = luminance(c);
			c.assign(mix(vec3(l), c, U.saturation));
			const split = mix(U.shadows, U.highlights, smoothstep(0.05, 0.7, l));
			c.assign(mix(c, c.mul(split.mul(1.25)), U.splitAmount.mul(float(1).sub(l.mul(0.6)))));
			return vec4(clamp(c, 0, 1), 1);
		})();
		let aa = o.aa === 'SMAA' ? own(smaa(graded)) : o.aa === 'FXAA' ? own(fxaa(graded)) : graded;
		// contrast-adaptive sharpening (0 = off .. 1 = strong) recovers detail lost to AA / upscaling
		if (o.sharpen) aa = own(sharpen(aa, float(2).sub(clamp(U.sharpen, 0, 1).mul(2))));
		const final = Fn(() => {
			const p = uv().sub(0.5);
			const vig = float(1).sub(smoothstep(0.25, 0.95, length(p.mul(vec2(1.0, 0.82)))).mul(U.vignette));
			const n = hash(screenCoordinate.x.toUint().add(screenCoordinate.y.toUint().mul(4099)).add(time.mul(60).toUint().mul(7919))).sub(0.5);
			// 2.39:1 letterbox (animated in/out)
			const bar = max(float(1).sub(screenSize.x.div(screenSize.y).div(2.39)), 0.0).mul(0.5).mul(U.letterbox);
			const lb = step(bar, uv().y).mul(step(uv().y, float(1).sub(bar)));
			// lite renders well under native res: full-strength grain would upscale into blocky noise
			let c = aa.rgb.mul(vig).add(n.mul(this.lite ? U.grain.mul(0.5) : U.grain)).mul(U.fade);
			if (this.titleTexture) {
				// title card (2:1 texture, ~70% of the frame width), composited additively-ish;
				// on narrow (portrait) screens it shrinks to fit the width instead of being cropped
				const W = min(float(1.3), screenSize.x.div(screenSize.y).mul(0.92)).mul(U.titleScale);
				const tuv = vec2(uv().x.sub(0.5).mul(screenSize.x.div(screenSize.y)).div(W).add(0.5), uv().y.sub(0.5).div(W.mul(0.5)).add(0.5));
				const inside = step(0.0, tuv.x).mul(step(tuv.x, 1.0)).mul(step(0.0, tuv.y)).mul(step(tuv.y, 1.0));
				const tc = texture(this.titleTexture, vec2(tuv.x, tuv.y.oneMinus()));
				const a = tc.a.mul(inside).mul(U.title);
				c = mix(c.mul(float(1).sub(U.title.mul(0.35))), tc.rgb, a);
			}
			return vec4(c.mul(lb), 1);
		})();
		this.pipeline.outputNode = final;
		this.pipeline.needsUpdate = true;
	}

	render(dt = 1 / 60) {
		this.u.shutter.value = Math.min(1, 1 / 60 / Math.max(dt, 1e-4));
		const cam = this.scenePass.camera;
		cam.updateMatrixWorld();
		updateCameraRotation(cam);
		this.pipeline.render();
	}
}
