// Dev-only: ?xremu installs Meta's Immersive Web Emulation Runtime (a virtual Quest 3
// with Touch controllers) so the VR mode can be exercised without a headset.
// Drive it from the console via window.__xrdevice (see node_modules/iwer).
// ?xremu=headless also keeps the WebGL backend running in a hidden tab (automated
// testing): rAF is pumped through a MessageChannel and shader compiles are synchronous.

export async function installXREmulator({ headless = false } = {}) {
	if (headless) {
		const ge = WebGL2RenderingContext.prototype.getExtension;
		WebGL2RenderingContext.prototype.getExtension = function (n) { return n === 'KHR_parallel_shader_compile' ? null : ge.call(this, n); };
		const ch = new MessageChannel();
		let q = [], last = 0, id = 0;
		ch.port1.onmessage = () => {
			const now = performance.now();
			if (now - last < 14) { ch.port2.postMessage(0); return; }
			last = now;
			const cbs = q;
			q = [];
			for (const [, cb] of cbs) cb(now);
			if (q.length) ch.port2.postMessage(0);
		};
		window.requestAnimationFrame = (cb) => { q.push([++id, cb]); if (q.length === 1) ch.port2.postMessage(0); return id; };
		window.cancelAnimationFrame = (h) => { q = q.filter(([i]) => i !== h); };
	}
	const { XRDevice, metaQuest3 } = await import('iwer');
	const device = new XRDevice(metaQuest3);
	device.installRuntime({ forceInstall: true });
	// XR Layers: the projection-layer path is the one Quest Browser takes. (iwer's own
	// polyfillLayers option gets its XRWebGLBinding overwritten right after, so inject it here.)
	const { default: WebXRLayersPolyfill } = await import('webxr-layers-polyfill');
	new WebXRLayersPolyfill();
	window.__xrdevice = device;
	return device;
}
