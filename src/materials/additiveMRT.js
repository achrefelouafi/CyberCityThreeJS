// Additive (transparent) layers must not disturb the scene's auxiliary MRT targets:
// with additive blending, writing zero leaves the opaque surface's motion vector,
// normal and SSR mask untouched (otherwise motion blur smears garbage through them).
import { mrt, vec2, vec3 } from 'three/tsl';

export const additiveMRT = () => mrt({ velocity: vec2(0), normal: vec3(0), reflect: vec2(0) });
