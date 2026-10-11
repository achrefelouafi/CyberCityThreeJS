// In-page side of the offline renderer (injected after the app has booted).
// window.CLIP (the clip script) can define:
//   setup(app, K)          once, before warm-up (look, seed, city radius, modes...)
//   frame(app, t, K)       every frame before the simulation step (car speed, uniforms...; may be async)
//   camera(app, t, K)      every frame after the simulation, right before the render
//                          (car.root is already at this frame's position: no lag)
//   overlay(g, t, K)       2D canvas over the finished frame (in clip-size coordinates: 1920x1080 unless CLIP.size)
//   warm                   seconds simulated before t = 0 (streams chunks, settles blur)
(() => {
	const app = window.__app;
	const K = window.__K;
	const V = (window.__vid = {});
	const { renderer, camera } = app;

	V.init = async ({ w, h, ss, fps, from, assetBase, size }) => {
		const clip = window.CLIP;
		K.app = app;
		[K.W, K.H] = size; // overlay coordinates are full-quality pixels, scaled down for previews
		K.fps = fps;
		K.assetBase = assetBase;
		// the app's own module instance of three (same class identities as the renderer)
		const threeUrl = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /three_webgpu\.js/.test(n));
		const THREE = (K.THREE = await import(threeUrl));
		renderer.setAnimationLoop(null); // we drive every frame from here on
		V.t0 = window.__clock.start();
		for (const id of ['hud', 'loader', 'shot', 'rec']) document.getElementById(id)?.classList.add('hidden');

		// videos: no free-running playback; each frame seeks every clip to the virtual time
		const vids = app.videos;
		vids.update = () => {};
		vids.resume = () => {};
		for (const c of vids.clips) c.video.pause();

		V.w = w; V.h = h; V.fps = fps;
		V.W = Math.round(w * ss); V.H = Math.round(h * ss);
		renderer.setPixelRatio(1);
		renderer.setSize(V.W, V.H, false);
		camera.aspect = V.W / V.H;
		camera.updateProjectionMatrix();
		V.rt = new THREE.RenderTarget(V.W, V.H, { type: THREE.UnsignedByteType, depthBuffer: false });
		V.full = Object.assign(document.createElement('canvas'), { width: V.W, height: V.H });
		V.out = Object.assign(document.createElement('canvas'), { width: w, height: h });
		V.fg = V.full.getContext('2d', { willReadFrequently: false });
		V.og = V.out.getContext('2d');
		K.canvas = V.out;

		// camera hook: runs after the car moved this frame, before anything is drawn
		const post = app.post, render = post.render.bind(post);
		post.render = (dt) => {
			if (window.CLIP.camera) {
				window.CLIP.camera(app, V.t, K);
				camera.updateMatrixWorld();
			}
			render(dt);
		};
		await clip.setup?.(app, K);
		await K.loadAssets?.();
		// warm-up: stream the city, compile late pipelines, settle motion blur / damping
		const warm = clip.warm ?? 1.5, nw = Math.round(warm * fps);
		for (let i = -nw; i < 0; i++) await V.step(from + i / fps, false);
		await renderer.backend.device?.queue.onSubmittedWorkDone();
	};

	V.seekVideos = async (t) => {
		const clips = app.videos.clips;
		if (!clips.length) return;
		await Promise.all(clips.map((c) => new Promise((res) => {
			const v = c.video, d = v.duration || 8;
			const target = (((t + 100 + c.tile * 1.37) % d) + d) % d;
			if (Math.abs(v.currentTime - target) < 0.004 || v.readyState < 1) return res();
			const to = setTimeout(res, 800);
			v.addEventListener('seeked', () => { clearTimeout(to); res(); }, { once: true });
			v.currentTime = target;
		})));
		app.videos.draw();
	};

	V.step = async (t, capture = true) => {
		const dt = 1 / V.fps;
		V.t = t;
		K.t = t;
		window.__clock.set(V.t0 + (t + 100) * 1000);
		if (Math.round(t * V.fps) % 2 === 0) await V.seekVideos(t);
		await window.CLIP.frame?.(app, t, K);
		const nf = renderer._nodes.nodeFrame;
		renderer.setRenderTarget(V.rt);
		nf.update();
		renderer.info.frame = nf.frameId;
		app.frame(dt);
		renderer.setRenderTarget(null);
		if (!capture) return;
		const px = await renderer.readRenderTargetPixelsAsync(V.rt, 0, 0, V.W, V.H);
		// WebGPU pads readback rows to 256 bytes (e.g. a 1440 px wide half-screen panel); three
		// sizes the buffer (H - 1) * stride + row, so the last row carries no padding
		const row = V.W * 4, stride = Math.ceil(row / 256) * 256;
		let data = new Uint8ClampedArray(px.buffer, px.byteOffset, V.W * V.H * 4);
		if (stride !== row) {
			data = new Uint8ClampedArray(V.W * V.H * 4);
			const src = new Uint8Array(px.buffer, px.byteOffset, px.byteLength);
			for (let y = 0; y < V.H; y++) data.set(src.subarray(y * stride, y * stride + row), y * row);
		}
		for (let i = 3; i < data.length; i += 4) data[i] = 255;
		V.fg.putImageData(new ImageData(data, V.W, V.H), 0, 0);
		const g = V.og;
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.globalAlpha = 1;
		g.globalCompositeOperation = 'source-over';
		g.filter = 'none';
		g.imageSmoothingEnabled = true;
		g.imageSmoothingQuality = 'high';
		g.drawImage(V.full, 0, 0, V.w, V.h);
		if (window.CLIP.overlay) {
			g.save();
			g.scale(V.w / K.W, V.h / K.H);
			window.CLIP.overlay(g, t, K);
			g.restore();
		}
	};

	V.frame = async (i) => {
		await V.step(i / V.fps, true);
		const blob = await new Promise((r) => V.out.toBlob(r, 'image/jpeg', 0.95));
		const buf = new Uint8Array(await blob.arrayBuffer());
		let s = '';
		for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
		return btoa(s);
	};
})();
