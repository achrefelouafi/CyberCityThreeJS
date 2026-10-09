// Shared neon palette (the "Palette" panel of CC_CityGenerator) as TSL uniforms.
import { Color } from 'three/webgpu';
import { uniform, select, float } from 'three/tsl';

export const paletteUniforms = [0, 1, 2, 3].map(() => uniform(new Color()));

export function setPalette(colors) {
	colors.forEach((c, i) => paletteUniforms[i].value.setRGB(c[0], c[1], c[2]));
}

/** TSL: palette colour for an index node (0..3, float). */
export function paletteColor(i) {
	const p = paletteUniforms;
	const f = float(i);
	return select(f.lessThan(0.5), p[0], select(f.lessThan(1.5), p[1], select(f.lessThan(2.5), p[2], p[3])));
}
