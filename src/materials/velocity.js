// Camera-only motion vectors for static, instanced city geometry.
// three's built-in velocity uses the previous *instance* matrices; the city
// streamer re-packs instance buffers whenever chunks stream in, which would
// produce one frame of garbage motion blur. The city is static, so its motion
// is purely the camera's: compare against last frame's view-projection.
import { Matrix4 } from 'three/webgpu';
import { Fn, uniform, vec4, positionWorld, cameraProjectionMatrix, cameraViewMatrix } from 'three/tsl';

export const prevViewProj = uniform(new Matrix4());

export const cameraVelocity = Fn(() => {
	const p = vec4(positionWorld, 1.0);
	const curr = cameraProjectionMatrix.mul(cameraViewMatrix).mul(p);
	const prev = prevViewProj.mul(p);
	return curr.xy.div(curr.w).sub(prev.xy.div(prev.w));
})();

const _vp = new Matrix4();

/** Call after rendering a frame. */
export function storeViewProj(camera) {
	_vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
	prevViewProj.value.copy(_vp);
}

/** Origin rebasing moved the world by -delta: keep last frame's matrix consistent. */
export function rebaseViewProj(delta) {
	prevViewProj.value.multiply(new Matrix4().makeTranslation(delta.x, delta.y, delta.z));
}
