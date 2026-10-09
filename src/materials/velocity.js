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

// rotation-only view-projection (current inverse + previous), used by the post stack to
// separate camera-turn motion from camera-travel motion
export const prevViewProjRot = uniform(new Matrix4());
export const invViewProjRot = uniform(new Matrix4());

const _vp = new Matrix4();
const _rot = new Matrix4();
const rotViewProj = (camera, out) => out.multiplyMatrices(camera.projectionMatrix, _rot.copy(camera.matrixWorldInverse).setPosition(0, 0, 0));

/** Call before rendering a frame. */
export function updateCameraRotation(camera) {
	rotViewProj(camera, invViewProjRot.value).invert();
}

/** Call after rendering a frame. */
export function storeViewProj(camera) {
	_vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
	prevViewProj.value.copy(_vp);
	rotViewProj(camera, prevViewProjRot.value);
}

/** Origin rebasing moved the world by -delta: keep last frame's matrix consistent. */
export function rebaseViewProj(delta) {
	prevViewProj.value.multiply(new Matrix4().makeTranslation(delta.x, delta.y, delta.z));
}
