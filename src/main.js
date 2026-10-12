
import { WebGPURenderer, PerspectiveCamera, Scene, Timer, Vector3, Vector2, HemisphereLight, Color, DirectionalLight, RenderTarget, UnsignedByteType, MathUtils } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { loadKit } from './city/Kit.js';
import { CityLayout, paramsFromValues } from './city/layout.js';
import { CityStreamer } from './city/CityStreamer.js';
import { createSignAtlas, preloadFonts } from './materials/SignAtlas.js';
import { createArchitectureMaterial, archUniforms } from './materials/ArchitectureMaterial.js';
import { createHoloMaterial, holoUniforms } from './materials/HoloMaterial.js';
import { setPalette } from './materials/palette.js';
import { storeViewProj, rebaseViewProj } from './materials/velocity.js';
import { setupAtmosphere, buildEnvironment, buildCarEnvironment, atmo } from './world/Atmosphere.js';
import { createGround, groundUniforms } from './world/Ground.js';
import { createTraffic, updateTraffic, trafficUniforms } from './world/Traffic.js';
import { createRain, rainUniforms } from './world/Rain.js';
import { createSearchlights, setSearchlights, searchUniforms } from './world/Searchlights.js';
import { HoverCar, carUniforms } from './vehicle/HoverCar.js';
import { Autopilot } from './vehicle/Autopilot.js';
import { PlayerFlight, FlightInput, insideSolids } from './vehicle/PlayerFlight.js';
import { Director, SHOTS, DRIVE_CAMS } from './camera/Director.js';
import { Post } from './post/Post.js';
import { buildGui } from './ui/Gui.js';
import { Capture } from './ui/Capture.js';
import { Contact } from './ui/Contact.js';
import { TouchControls, isTouchFirst } from './ui/TouchControls.js';
import { LOOKS } from './looks.js';
import { TitleCard } from './ui/TitleCard.js';
import { VideoAtlas } from './media/VideoAtlas.js';
import { createPosterAtlas } from './media/PosterAtlas.js';
import { HoloLayer, holoLayerUniforms } from './world/HoloLayer.js';
import { Wires, wireUniforms } from './world/Wires.js';
import { HoloArt, holoArtUniforms } from './world/HoloArt.js';
import { installLightCulling } from './materials/lightCulling.js';
import { precompile } from './utils/precompile.js';
import { XRDrive, XR_VIEWS, wantsXRBackend, xrSupport, isHeadsetBrowser } from './xr/XRDrive.js';

const $ = (id) => document.getElementById(id);
const progress = (p, msg) => { $('loader-fill').style.width = `${Math.round(p * 100)}%`; if (msg) $('loader-msg').textContent = msg; };
const params = new URLSearchParams(location.search);

async function main() {
	installLightCulling();
	progress(0.05, 'READING BLENDER MANIFEST');
	const manifest = await (await fetch('/assets/manifest.json')).json();
	// float32 values from Blender (0.30000001...) -> tidy decimals; F() in layout.js rounds back identically
	const values = Object.fromEntries(Object.entries(manifest.city.values).map(([k, v]) => [k, typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(6) : v]));
	if (params.has('seed')) values.Seed = +params.get('seed');

	// ------------------------------------------------------------------ renderer
	const canvas = $('view');
	// XR mode: WebXR presents through the WebGL backend (browsers don't ship the WebXR/WebGPU
	// binding yet), so headset browsers boot on it directly and desktops reboot into it
	// (?xr) when VR is requested. ?xremu adds an emulated Quest 3 for headset-less testing.
	const xrBackend = wantsXRBackend(params);
	if (params.has('xremu')) document.body.classList.add('xr-emu');
	if (params.has('xremu')) await (await import('./xr/emulator.js')).installXREmulator({ headless: params.get('xremu') === 'headless' });
	// reversed-Z + float32 depth: near-uniform depth precision from 0.25 m to 4 km, which is
	// what kills the Z-fighting on distant facades, signs and trims. (Off in XR mode: the XR
	// projection matrices come from the headset and the XR depth buffer is 24-bit anyway.)
	const renderer = new WebGPURenderer({
		canvas, antialias: false, powerPreference: 'high-performance',
		reversedDepthBuffer: !xrBackend, forceWebGL: xrBackend,
		// multiview (one pass for both eyes) on the headset; the emulator's layers polyfill can't do it
		multiview: xrBackend && params.get('xrmv') !== '0' && !params.has('xremu'),
	});
	await renderer.init();
	// render scale = CSS px -> render px. Auto mode adapts it between min and max to hold
	// ~60 fps; max > 1 supersamples on fast GPUs (the cleanest anti-aliasing there is).
	// Phones and tablets run the lite post profile (see Post.js) at 1x and may climb a little:
	// their 3x screens would otherwise open on 9x the pixels of a desktop. The floor stays at
	// 1x — below it the upscaled image goes soft and jaggy, which reads worse than a few fps.
	const touchFirst = isTouchFirst();
	const lite = params.has('lite') ? params.get('lite') !== '0' : touchFirst;
	const quality = touchFirst ? {
		scale: Math.min(1, +(params.get('dpr') ?? 1)),
		auto: !params.has('dpr'), min: 1, max: Math.min(Math.max(window.devicePixelRatio, 1), 1.5),
	} : {
		scale: Math.min(Math.max(window.devicePixelRatio, 1), +(params.get('dpr') ?? 2)),
		auto: !params.has('dpr'), min: 0.85, max: Math.max(1.5, Math.min(window.devicePixelRatio, 2)),
	};
	renderer.setPixelRatio(quality.scale);
	const W = () => Math.max(window.innerWidth, 320), H = () => Math.max(window.innerHeight, 180);
	renderer.setSize(W(), H());
	renderer.toneMappingExposure = 1.0;

	const scene = new Scene();
	const camera = new PerspectiveCamera(62, W() / H(), 0.25, 4200);

	progress(0.12, 'LOADING NEON TYPE');
	await preloadFonts();
	const atlas = createSignAtlas();

	progress(0.18, 'STREAMING HOLO FOOTAGE');
	const videos = await new VideoAtlas().load('/');

	progress(0.22, 'LOADING GEOMETRY NODES KIT');
	const kit = await loadKit('/assets/kit.glb', manifest);
	progress(0.38, 'LOADING KX-9 KESTREL');
	const car = await new HoverCar().load('/assets/car.glb');

	// ------------------------------------------------------------------ materials & world
	const applyCityUniforms = () => {
		setPalette([1, 2, 3, 4].map((i) => values[`Neon ${i}`]));
		archUniforms.floorH.value = values['Floor Height'];
		groundUniforms.street.value = values['Street Width'];
		groundUniforms.block.value = values['Block Size'];
	};
	applyCityUniforms();
	const wg = manifest.materials.CC_Glass.windowGrid;
	archUniforms.winW.value = wg['Window Width'];
	archUniforms.lit.value = wg['Lit Ratio'];

	const material = createArchitectureMaterial(atlas, videos.texture);
	archUniforms.videoOn.value = videos.screens.length ? 1 : 0;
	archUniforms.screenBase.value = videos.screens[0] ?? 0;
	archUniforms.screenCount.value = Math.max(videos.screens.length, 1);
	const holo = createHoloMaterial();
	const layout = new CityLayout(paramsFromValues(values), manifest.channels);
	groundUniforms.pitch.value = layout.pitch;

	const sky = setupAtmosphere(scene, renderer);
	sky.update(true);
	progress(0.5, 'PREFILTERING ENVIRONMENT');
	scene.environment = buildEnvironment(renderer);
	scene.environmentIntensity = 0.32;
	car.setEnvironment(buildCarEnvironment(renderer));
	const hemi = new HemisphereLight(0x4a2cbf, 0x080008, 0.12);
	scene.add(hemi);
	const moon = new DirectionalLight(0x8da8ff, 0.18);
	moon.position.set(-0.4, 1, 0.3);
	scene.add(moon);

	const ground = createGround();
	scene.add(ground);
	const traffic = createTraffic(kit.get('V1_Traffic'));
	scene.add(traffic);
	const rain = createRain();
	scene.add(rain);
	car.addTo(scene);

	// ------------------------------------------------------------------ city + flight
	progress(0.6, 'GENERATING CITY FROM GN LAYOUT');
	const city = new CityStreamer({ scene, layout, kit, material, holoMaterial: holo, chunkBlocks: 4, radius: +(params.get('radius') ?? (touchFirst ? 2 : 3)), detailRadius: 1, midRadius: touchFirst ? 1 : 2 });
	const ap = new Autopilot(layout, values.Seed * 31 + 7);
	// switching into XR mode reloads the page: pick up where the car was
	const SPOT_KEY = 'neokyoto.spot';
	let spot = null;
	try { spot = JSON.parse(sessionStorage.getItem(SPOT_KEY) ?? 'null'); sessionStorage.removeItem(SPOT_KEY); } catch { /* storage blocked */ }
	ap.reset(spot?.i ?? 0, spot?.j ?? 0, spot?.dir ?? 0);
	const renderPos = new Vector3().copy(ap.pos);
	camera.position.copy(renderPos).add(new Vector3(-12, 4, 0));
	city.fill(camera);

	const wires = new Wires();
	wires.addTo(scene);
	const holoLayer = new HoloLayer({ videoAtlas: videos, signAtlas: atlas, posterAtlas: await createPosterAtlas() });
	scene.add(holoLayer.mesh);
	progress(0.66, 'PROJECTING HOLOGRAMS');
	const holoArt = await new HoloArt(kit).loadCharacters('/assets/holo/');
	scene.add(holoArt.group);
	$('hud-credits').textContent = (videos.credits.length ? 'FOOTAGE: ' + videos.credits.join(' · ') + ' · ' : '')
		+ 'HOLOGRAMS: Fox (CC0 PixelMannen, rig CC BY 4.0 tomkranis) · RobotExpressive (CC0 Tomás Laulhé)';

	const searchlights = createSearchlights();
	scene.add(searchlights);
	city.onPack = () => setSearchlights(searchlights, city.landmarks, camera.position);
	city.onPack();

	const director = new Director(camera);
	const shotEl = $('shot');
	let shotTimer;
	director.onShot = (label) => {
		shotEl.textContent = label;
		shotEl.classList.add('show');
		clearTimeout(shotTimer);
		shotTimer = setTimeout(() => shotEl.classList.remove('show'), 1600);
	};
	// player flight: grab the stick at any time (WASD / arrows / gamepad)
	const player = new PlayerFlight(layout);
	const input = new FlightInput();
	director.attachMouse(canvas);
	director.solidTest = (p) => insideSolids(layout, p, 1.0);
	let pilot = false, pilotIdle = 0;
	// you fly by default; ?cinematic starts on the auto-directed film, ?kiosk returns to it when idle
	const kiosk = params.has('kiosk');
	const fade = { t: 1 };

	// ------------------------------------------------------------------ WebXR
	const xr = new XRDrive({ renderer, scene, car, toast: (t) => director.onShot(t) });
	const _abs = new Vector3();
	xr.solidTest = (p) => insideSolids(layout, _abs.copy(p).add(city.origin), 1.5); // render space -> absolute
	const vrBtn = $('vr-btn');
	const vrUi = { toggle: () => toggleVR(), xrBackend: !!renderer.backend.isWebGLBackend && xrBackend, view: XR_VIEWS[0] };
	let normalRadius = city.radius;
	let vrSupport = null; // last xrSupport() answer: the click handler must not await it (see toggleVR)
	const setVrButton = async () => {
		if (xr.presenting) { vrBtn.innerHTML = '◉ EXIT VR <b>X</b>'; vrBtn.classList.remove('ready'); return; }
		const sup = vrSupport = await xrSupport();
		vrBtn.classList.toggle('na', !sup.ok);
		vrBtn.title = sup.ok ? 'Fly the Kestrel in your headset (X)' : sup.why;
		vrBtn.innerHTML = sup.ok && xrBackend ? '◉ ENTER VR <b>X</b>' : '◉ VR <b>X</b>';
		vrBtn.classList.toggle('ready', sup.ok && xrBackend);
	};
	const saveSpot = () => {
		const s = pilot ? player : ap, P = layout.pitch, f = s.forward;
		const dir = Math.abs(f.x) > Math.abs(f.z) ? (f.x > 0 ? 0 : 2) : (f.z < 0 ? 1 : 3);
		try { sessionStorage.setItem(SPOT_KEY, JSON.stringify({ i: Math.round(s.pos.x / P), j: Math.round(-s.pos.z / P), dir })); } catch { /* ignore */ }
	};
	const reloadWith = (xrOn) => {
		saveSpot();
		const u = new URL(location.href);
		u.searchParams.set('xr', xrOn ? '1' : '0');
		location.href = u.toString();
	};
	function toggleVR() {
		if (xr.presenting) { xr.exit(); return; }
		if (vrSupport && !vrSupport.ok) { director.onShot(vrSupport.why); return; }
		if (!renderer.backend.isWebGLBackend) {
			// this canvas runs on WebGPU, which can't present to WebXR yet: reboot on the XR renderer
			director.onShot('SWITCHING TO THE XR RENDERER…');
			setTimeout(() => reloadWith(true), 400);
			return;
		}
		// requestSession() is only allowed inside the click's user activation, so it is called
		// right here with nothing awaited first (the headset shows its own loading screen
		// until the stereo shaders are ready)
		xr.enter().catch((e) => { console.error(e); director.onShot('VR FAILED: ' + String(e.message ?? e).toUpperCase()); });
	}
	xr.onAutopilot = (on) => {
		if (on && pilot) { exitPilot('chase'); xr.say('AUTOPILOT ENGAGED · LOOK AROUND', 3); }
		else if (!on && !pilot) { enterPilot(); xr.say('YOU HAVE CONTROL'); }
	};
	xr.onSessionChange = (on) => {
		document.body.classList.toggle('in-vr', on);
		if (on) {
			if (!pilot) enterPilot();
			normalRadius = city.radius;
			city.radius = Math.min(city.radius, xr.opts.drawDistance);
			city.fill(camera);
		} else {
			city.radius = normalRadius;
			city.fill(camera);
			camera.aspect = W() / H();
			camera.fov = 62;
			camera.updateProjectionMatrix();
			director.cut = true;
		}
		setVrButton();
	};
	vrBtn.addEventListener('click', () => toggleVR());
	setVrButton();
	navigator.xr?.addEventListener?.('devicechange', setVrButton);

	const controls = new OrbitControls(camera, canvas);
	controls.enabled = false;
	controls.enableDamping = true;

	// ------------------------------------------------------------------ post
	const title = new TitleCard();
	const post = new Post(renderer, scene, camera, title.texture, { lite });
	const capture = new Capture(canvas);

	// ------------------------------------------------------------------ GUI
	const cinema = { letterbox: !params.has('noletterbox'), dof: 1.6, dofRange: 7 };
	const playTitle = () => title.play();
	let lastLayoutKey = JSON.stringify(paramsFromValues(values));
	const onCityChange = () => {
		applyCityUniforms();
		const p = paramsFromValues(values);
		const key = JSON.stringify(p);
		if (key === lastLayoutKey) return; // palette only
		lastLayoutKey = key;
		layout.setParams(p);
		groundUniforms.pitch.value = layout.pitch;
		const abs = ap.pos.clone();
		ap.reset(Math.round(abs.x / layout.pitch), Math.round(-abs.z / layout.pitch), ap.dir ?? 0);
		city.regenerate(camera);
	};
	const look = { name: params.get('look') ?? 'Neon Noir' };
	const applyLook = (name) => {
		const L = LOOKS[name];
		if (!L) return;
		L.palette.forEach((c, i) => (values[`Neon ${i + 1}`] = [...c, 1]));
		applyCityUniforms();
		for (const [k, v] of Object.entries(L.atmo)) atmo[k].value.set?.(...(Array.isArray(v) ? v : [v])) ?? (atmo[k].value = v);
		for (const [k, v] of Object.entries(L.post)) post.u[k].value.set?.(...(Array.isArray(v) ? v : [v])) ?? (post.u[k].value = v);
		car.trails[0].color.value.setRGB(...L.palette[1]);
		car.trails[1].color.value.setRGB(...L.palette[0]);
		carUniforms.neon.value.setRGB(...L.palette[1]);
		gui?.controllersRecursive().forEach((c) => c.updateDisplay());
	};
	const U = (u, key = 'value') => ({ obj: u, key });
	const camState = { mode: 'cinematic', shot: 'chase', driveCam: DRIVE_CAMS[0], cut: () => director._next() };
	const flight = { speed: ap.cruise, boost: false };
	const rebuildPost = () => post.build();
	const refreshGui = () => gui?.controllersRecursive().forEach((c) => c.updateDisplay());
	const gui = buildGui({
		manifest, values, onCityChange,
		groups: {
			'Look': [
				{ obj: look, key: 'name', name: 'preset', options: Object.keys(LOOKS), onChange: applyLook },
				{ obj: renderer, key: 'toneMappingExposure', min: 0.2, max: 3, step: 0.01, name: 'exposure' },
			],
			'Camera': [
				{ obj: camState, key: 'mode', options: ['drive', 'cinematic', 'chase', 'free'], onChange: (m) => (m === 'drive' ? (pilot || enterPilot()) : setMode(m)) },
				{ obj: camState, key: 'shot', options: SHOTS.slice(1), onChange: (s) => { director.mode = 'cinematic'; director._start(s); } },
				{ obj: camState, key: 'cut', name: 'next shot' },
				{ obj: camState, key: 'driveCam', name: 'pilot camera', options: DRIVE_CAMS, onChange: (c) => { if (!pilot) enterPilot(); director.setDriveCam(DRIVE_CAMS.indexOf(c)); } },
				{ obj: director, key: 'shake', min: 0, max: 3, step: 0.01 },
			],
			'Flight': [
				{ obj: ap, key: 'cruise', min: 15, max: 110, step: 1, name: 'cruise m/s' },
				{ obj: ap, key: 'turnSpeed', min: 10, max: 40, step: 1, name: 'turn m/s' },
				{ ...U(carUniforms.neonI), min: 0, max: 30, step: 0.1, name: 'car neon' },
				{ obj: carUniforms.paint, key: 'value', color: true, name: 'car paint' },
			],
			'Materials (CC_*)': [
				{ ...U(archUniforms.winW), min: 1.2, max: 5, step: 0.01, name: 'Window Width' },
				{ ...U(archUniforms.lit), min: 0, max: 1, step: 0.01, name: 'Lit Ratio' },
				{ ...U(archUniforms.winI), min: 0, max: 6, step: 0.01, name: 'window intensity' },
				{ ...U(archUniforms.neonI), min: 0, max: 20, step: 0.01, name: 'neon intensity' },
				{ ...U(archUniforms.signI), min: 0, max: 20, step: 0.01, name: 'sign intensity' },
				{ ...U(archUniforms.screenI), min: 0, max: 10, step: 0.01, name: 'screen intensity' },
				{ ...U(archUniforms.shopI), min: 0, max: 10, step: 0.01, name: 'shopfront intensity' },
				{ ...U(archUniforms.glow), min: 0, max: 4, step: 0.01, name: 'street spill' },
				{ ...U(holoUniforms.intensity), min: 0, max: 8, step: 0.01, name: 'hologram' },
				{ ...U(searchUniforms.intensity), min: 0, max: 0.6, step: 0.001, name: 'searchlights' },
				{ ...U(holoLayerUniforms.intensity), min: 0, max: 4, step: 0.01, name: 'giant holograms' },
				{ ...U(holoLayerUniforms.adIntensity), min: 0, max: 4, step: 0.01, name: 'floating ads' },
				{ ...U(holoArtUniforms.intensity), min: 0, max: 4, step: 0.01, name: '3D holograms' },
				{ ...U(wireUniforms.lights), min: 0, max: 4, step: 0.01, name: 'lanterns & string lights' },
			],
			'Atmosphere': [
				{ ...U(atmo.fogDensity), min: 0, max: 0.012, step: 0.0001, name: 'fog density' },
				{ ...U(atmo.fogHeight), min: 10, max: 300, step: 1, name: 'fog height' },
				{ ...U(atmo.fogBase), min: 0, max: 0.002, step: 0.00001, name: 'haze' },
				{ ...U(atmo.cloud), min: 0, max: 1.5, step: 0.01, name: 'clouds' },
				{ ...U(atmo.stars), min: 0, max: 2, step: 0.01, name: 'stars' },
				{ ...U(rainUniforms.amount), min: 0, max: 3, step: 0.01, name: 'rain' },
				{ ...U(groundUniforms.wet), min: 0, max: 1, step: 0.01, name: 'wet streets' },
				{ ...U(trafficUniforms.lights), min: 0, max: 3, step: 0.01, name: 'traffic lights' },
				{ ...U(trafficUniforms.speed), min: 0, max: 3, step: 0.01, name: 'traffic speed' },
			],
			'Post · Image Quality': [
				{ obj: quality, key: 'scale', min: 0.5, max: 2, step: 0.05, name: 'resolution scale', onChange: (v) => { quality.auto = false; renderer.setPixelRatio(v); refreshGui(); } },
				{ obj: quality, key: 'auto', name: 'auto resolution (hold 60 fps)' },
				{ obj: quality, key: 'min', min: 0.5, max: 1.5, step: 0.05, name: 'auto: min scale' },
				{ obj: quality, key: 'max', min: 0.75, max: 2, step: 0.05, name: 'auto: max scale' },
				{ obj: post.opts, key: 'aa', options: ['SMAA', 'FXAA', 'off'], name: 'anti-aliasing', onChange: rebuildPost },
				{ obj: post.opts, key: 'sharpen', name: 'sharpen pass', onChange: rebuildPost },
				{ ...U(post.u.sharpen), min: 0, max: 1, step: 0.01, name: 'sharpen amount' },
				{ ...U(post.u.motionBlur), min: 0, max: 2, step: 0.01, name: 'motion blur' },
				{ ...U(post.u.turnBlur), min: 0, max: 1, step: 0.01, name: 'blur when turning camera' },
				{ ...U(post.u.maxBlur), min: 0, max: 0.15, step: 0.001, name: 'max blur length' },
				{ ...U(post.u.grain), min: 0, max: 0.2, step: 0.001, name: 'film grain' },
				{ ...U(post.u.ca), min: 0, max: 2, step: 0.01, name: 'chromatic aberration' },
			],
			'Post · Depth of Field': [
				{ obj: post.opts, key: 'dof', name: 'enabled', onChange: rebuildPost },
				{ obj: cinema, key: 'dof', min: 0, max: 4, step: 0.01, name: 'bokeh size (close shots)' },
				{ obj: cinema, key: 'dofRange', min: 1, max: 40, step: 0.1, name: 'focus range m' },
				{ obj: cinema, key: 'letterbox', name: 'letterbox 2.39:1' },
			],
			'Post · Glow & Lens': [
				{ ...U(post.bloom.strength), min: 0, max: 3, step: 0.01, name: 'bloom' },
				{ ...U(post.bloom.radius), min: 0, max: 1, step: 0.01, name: 'bloom radius' },
				{ ...U(post.bloom.threshold), min: 0, max: 4, step: 0.01, name: 'bloom threshold' },
				{ ...U(post.u.anamorphic), min: 0, max: 3, step: 0.01, name: 'anamorphic streaks' },
				{ ...U(post.u.anaThreshold), min: 0, max: 10, step: 0.05, name: 'streak threshold' },
				{ ...U(post.u.haze), min: 0, max: 2, step: 0.01, name: 'haze glow' },
				{ ...U(post.u.lensDirt), min: 0, max: 2, step: 0.01, name: 'lens dirt' },
				{ ...U(post.u.ssr), min: 0, max: 4, step: 0.01, name: 'SSR (wet streets)' },
			],
			'Post · Grade': [
				{ ...U(post.u.contrast), min: 0.5, max: 2, step: 0.01, name: 'contrast' },
				{ ...U(post.u.saturation), min: 0, max: 2, step: 0.01, name: 'saturation' },
				{ ...U(post.u.splitAmount), min: 0, max: 1, step: 0.01, name: 'split tone' },
				{ ...U(post.u.vignette), min: 0, max: 1, step: 0.01, name: 'vignette' },
			],
			'VR · WebXR': [
				{ obj: vrUi, key: 'toggle', name: '◉ enter / exit VR (X)' },
				{ obj: vrUi, key: 'xrBackend', name: 'XR mode (WebGL backend · reloads)', onChange: (v) => reloadWith(v) },
				{ obj: vrUi, key: 'view', options: XR_VIEWS, name: 'headset view', onChange: (v) => { xr.view = (XR_VIEWS.indexOf(v) + XR_VIEWS.length - 1) % XR_VIEWS.length; xr.cycleView(); } },
				{ obj: xr.opts, key: 'comfortBank', min: 0, max: 1, step: 0.01, name: 'cabin bank (comfort)' },
				{ obj: xr.opts, key: 'vignette', min: 0, max: 1, step: 0.01, name: 'comfort vignette' },
				{ obj: xr.opts, key: 'drawDistance', min: 1, max: 5, step: 1, name: 'VR draw distance', onChange: (v) => { if (xr.presenting) { city.radius = v; city.fill(camera); } } },
				{ obj: xr.opts, key: 'exposure', min: 0.5, max: 2.5, step: 0.01, name: 'VR exposure', onChange: (v) => { if (xr.presenting) renderer.toneMappingExposure = xr._prevExposure * v; } },
				{ obj: xr.opts, key: 'framebufferScale', min: 0.5, max: 1.5, step: 0.05, name: 'VR resolution (next session)' },
				{ obj: xr.opts, key: 'foveation', min: 0, max: 1, step: 0.01, name: 'foveation', onChange: (v) => renderer.xr.setFoveation(v) },
			],
			'City · Streaming': [
				{ obj: city, key: 'radius', min: 1, max: 6, step: 1, name: 'draw distance (chunks)', onChange: () => city.fill(camera) },
				{ obj: city, key: 'midRadius', min: 0, max: 4, step: 1, name: 'mid-detail ring', onChange: () => (city.dirty = true) },
				{ obj: city, key: 'detailRadius', min: 0, max: 3, step: 1, name: 'full-detail ring', onChange: () => (city.dirty = true) },
				{ obj: camera, key: 'fov', min: 35, max: 100, step: 1, name: 'camera FOV', onChange: () => camera.updateProjectionMatrix() },
			],
		},
	});
	applyLook(look.name);

	// post settings are a per-viewer preference: remember them across reloads
	const postFolders = gui.folders.filter((f) => f._title.startsWith('Post'));
	const POST_KEY = 'neokyoto.post.v1';
	const postDefaults = postFolders.map((f) => f.save());
	try {
		const saved = JSON.parse(localStorage.getItem(POST_KEY) ?? 'null');
		if (saved) postFolders.forEach((f, i) => saved[i] && f.load(saved[i]));
	} catch { /* storage blocked or stale: keep defaults */ }
	const savePost = () => { try { localStorage.setItem(POST_KEY, JSON.stringify(postFolders.map((f) => f.save()))); } catch { /* ignore */ } };
	postFolders.forEach((f) => f.onFinishChange(savePost));
	postFolders[0].add({ reset: () => {
		postFolders.forEach((f, i) => f.load(postDefaults[i]));
		try { localStorage.removeItem(POST_KEY); } catch { /* ignore */ }
	} }, 'reset').name('↺ reset all post settings');
	postFolders[0].open();

	const settingsBtn = $('settings-btn');
	const toggleSettings = (show = gui.domElement.classList.contains('hidden-panel')) => {
		gui.domElement.classList.toggle('hidden-panel', !show);
		settingsBtn.classList.toggle('on', show);
	};
	settingsBtn.addEventListener('click', () => toggleSettings());
	if (params.has('settings')) toggleSettings(true);

	// ------------------------------------------------------------------ input
	const hud = $('hud');
	function enterPilot() {
		player.from(ap);
		pilot = true;
		pilotIdle = 0;
		setMode('drive');
	}
	function exitPilot(mode = 'cinematic') {
		const P = layout.pitch, f = player.forward;
		const dir = Math.abs(f.x) > Math.abs(f.z) ? (f.x > 0 ? 0 : 2) : (f.z < 0 ? 1 : 3);
		ap.reset(Math.round(player.pos.x / P), Math.round(-player.pos.z / P), dir);
		ap.alt = MathUtils.clamp(player.pos.y, 24, 160);
		ap.altVel = 0;
		ap.speed = MathUtils.clamp(player.speed, 18, 60);
		ap.pos.y = ap.alt;
		pilot = false;
		fade.t = 0; // the autopilot snaps to the nearest street: hide it with a quick fade
		setMode(mode);
	}
	function setMode(m) {
		if (pilot && m !== 'drive') { exitPilot(m); return; }
		camState.mode = m;
		$('hud-mode').textContent = m === 'drive' ? 'PILOT' : m.toUpperCase();
		const touch = document.body.classList.contains('touchscreen');
		$('hint').textContent = m === 'drive'
			? (touch ? 'PILOT · DRAG THE CITY TO LOOK' : 'PILOT · F COCKPIT · V CAMERA · DRAG TO LOOK · C CINEMATIC')
			: (touch ? 'TOUCH THE STICK — TAKE THE WHEEL' : 'C OR W A S D — TAKE THE WHEEL');
		document.body.classList.toggle('piloting', m === 'drive');
		if (m === 'drive') {
			controls.enabled = false;
			director.mode = 'drive';
			director.cut = false;
		} else if (m === 'free' || m === 'locked') {
			director.mode = 'free';
			controls.enabled = m === 'free';
			if (m === 'free') controls.target.copy(car.root.position);
		} else {
			controls.enabled = false;
			director.setMode(m);
		}
		gui.controllersRecursive().forEach((c) => c.updateDisplay());
	}
	// C toggles between flying yourself and the cinematic director
	const toggleFly = () => (camState.mode === 'drive' ? exitPilot('cinematic') : enterPilot());
	const cycleCam = () => { director.cycleDriveCam(); camState.driveCam = DRIVE_CAMS[director.driveCam]; };
	// first person: jump into the cockpit (and take the wheel), or back out to the chase cam
	const toggleCockpit = () => {
		if (!pilot) enterPilot();
		director.setDriveCam(director.driveCam === 2 ? 0 : 2);
		camState.driveCam = DRIVE_CAMS[director.driveCam];
	};
	const touchUi = new TouchControls(hud, input, {
		fly: toggleFly, cockpit: toggleCockpit,
		cam: () => { if (!pilot) enterPilot(); cycleCam(); },
	});
	window.addEventListener('keydown', (e) => {
		if (e.target.closest?.('.lil-gui')) return;
		const k = e.key.toLowerCase();
		if (k === 'c') toggleFly();
		else if (k === 'v') cycleCam();
		else if (k === 'f') toggleCockpit();
		else if (k === 'o') setMode(camState.mode === 'free' ? 'cinematic' : 'free');
		else if (k === 'h') { hud.classList.toggle('hidden'); toggleSettings(false); }
		else if (k === 'g') toggleSettings();
		else if (k === 'r') capture.toggle();
		else if (k === 'p') capture.wantPhoto = true;
		else if (k === ' ' && !pilot) { flight.boost = true; e.preventDefault(); }
		else if (k === 'n') director._next();
		else if (k === 'x') toggleVR();
		else if (k === 't') playTitle();
		else if (k === 'l') cinema.letterbox = !cinema.letterbox;
		else if (k >= '1' && k <= '8') { director.mode = 'cinematic'; director._start(SHOTS[+k]); }
	});
	for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => videos.resume());
	document.addEventListener('visibilitychange', () => videos.resume());
	window.addEventListener('keyup', (e) => { if (e.key === ' ') flight.boost = false; });
	const onResize = () => {
		camera.aspect = W() / H();
		camera.updateProjectionMatrix();
		renderer.setSize(W(), H());
	};
	window.addEventListener('resize', onResize);
	new ResizeObserver(onResize).observe(document.body);

	// ------------------------------------------------------------------ compile, then go
	progress(0.8, 'COMPILING WEBGPU PIPELINES');
	director.update(0.016, car, ap, city.origin);
	// compile what the first frames actually draw: the post stack's scene pass (its render
	// target + MRT outputs), not a plain canvas render — otherwise the page froze for a while
	// right after the loader (and swallowed clicks), compiling it all on the first frames.
	// three keys shader builds by render context, which includes how deeply nested the render
	// call is, and the pass renders nested inside the post effects: one frame with an empty
	// scene compiles the post stack itself and tells us that depth.
	const contexts = renderer._renderContexts, contextAt = contexts.get, sceneMRT = post.scenePass.getMRT();
	let passDepth = 0;
	contexts.get = (target, mrt, depth) => { if (mrt === sceneMRT) passDepth = depth; return contextAt.call(contexts, target, mrt, depth); };
	post.scenePass.scene = new Scene();
	post.render();
	post.scenePass.scene = scene;
	contexts.get = (target, mrt) => contextAt.call(contexts, target, mrt, passDepth);
	renderer.setRenderTarget(post.scenePass.renderTarget);
	renderer.setMRT(sceneMRT);
	try {
		await precompile(renderer, scene, camera, { onProgress: (f) => progress(0.8 + f * 0.19) });
	} finally {
		contexts.get = contextAt;
		renderer.setRenderTarget(null);
		renderer.setMRT(null);
	}
	progress(1, 'ONLINE');
	const contactCard = new Contact($('hud'));
	setTimeout(() => { $('loader').classList.add('done'); contactCard.reveal(); }, 300);
	if (!params.has('notitle')) setTimeout(playTitle, 700);
	director.setMode('cinematic');
	director._start(params.get('shot') ?? 'crane'); // open on an establishing crane
	if (!params.has('cinematic') && !params.has('shot') && !kiosk) setTimeout(() => { if (!pilot) enterPilot(); }, params.has('notitle') ? 0 : 2600);
	// headset-ready boot: build the stereo shaders in the background, so ENTER VR doesn't sit in the dark
	if (vrUi.xrBackend) setTimeout(() => xr.prewarm(camera), 1500);

	const timer = new Timer();
	timer.connect(document);
	const prevCar = new Vector3().copy(car.root.position);
	let fpsAcc = 0, fpsN = 0, hudSector = '', hudFps = 0, yokeAngle = 0;
	const frame = (dt) => {
		// who flies the car: autopilot, or the player as soon as they touch the controls
		const vr = xr.presenting;
		const xin = vr ? xr.read(dt) : null;
		if (!pilot && (input.active || xin?.active) && camState.mode !== 'locked') enterPilot();
		let fs, ctl = null;
		if (pilot) {
			const kb = input.read();
			ctl = xin ? { throttle: xin.throttle || kb.throttle, steer: xin.steer || kb.steer, lift: xin.lift || kb.lift, boost: xin.boost || kb.boost } : kb;
			fs = player.update(dt, ctl);
			pilotIdle = input.active || xin?.active || Math.abs(player.speed) > 3 && ctl.throttle ? 0 : pilotIdle + dt;
			if (kiosk && pilotIdle > 30) exitPilot('cinematic'); // kiosk: hand back to the director
		} else {
			ap.boost = flight.boost ? Math.min(ap.boost + dt * 2, 1) : Math.max(ap.boost - dt, 0);
			fs = ap.update(dt);
		}
		fade.t = Math.min(1, fade.t + dt * 2.5);
		post.u.fade.value = fade.t * fade.t * (3 - 2 * fade.t);
		renderPos.copy(fs.pos).sub(city.origin);
		xr.autopilot = !pilot;
		car.comfort = vr && xr.view === 0 ? xr.opts.comfortBank : 1;
		car.update(dt, fs, renderPos, camera);
		if (vr) {
			// headset: your tracking space rides the car; the shared camera follows your head
			xr.update(dt, fs, camera, { fade: 1 - post.u.fade.value, steer: ctl ? ctl.steer : MathUtils.clamp(fs.bank * 1.2, -1, 1), sector: hudSector, fps: hudFps });
		} else if (camState.mode === 'locked') {
			// dev/look-dev: camera is left exactly where it was put
		} else if (camState.mode === 'free') {
			const d = car.root.position.clone().sub(prevCar);
			camera.position.add(d);
			controls.target.copy(car.root.position);
			controls.update();
		} else director.update(dt, car, fs, city.origin);
		if (!vr) {
			// the cockpit yoke turns with the steering (in VR, XRDrive drives it from your hands)
			yokeAngle = MathUtils.damp(yokeAngle, -(ctl ? ctl.steer : MathUtils.clamp(fs.bank * 1.2, -1, 1)) * 0.9, 8, dt);
			car.setYoke(yokeAngle);
		}
		const inside = vr ? xr.inCockpit : camState.mode === 'drive' && director.inCockpit;
		carUniforms.inside.value = MathUtils.damp(carUniforms.inside.value, inside ? 1 : 0, 10, dt);
		document.body.classList.toggle('cockpit', inside && !vr);
		touchUi.sync(pilot, inside);
		car.updateScreens(dt, {
			speed: fs.speed, alt: fs.alt, boost: fs.boost ?? 0, throttle: carUniforms.throttle.value / 1.4,
			heading: Math.atan2(-fs.forward.z, fs.forward.x), x: fs.pos.x, z: fs.pos.z,
			pitch: layout.pitch, street: values['Street Width'], mode: camState.mode,
		});
		prevCar.copy(car.root.position);

		// cinematic layer: rack focus onto the car on close shots, letterbox in cinematic mode
		const close = camState.mode === 'cinematic' && ['orbit', 'side', 'front', 'low'].includes(director.shot);
		post.u.dofAmount.value = MathUtils.damp(post.u.dofAmount.value, close ? cinema.dof : 0, 3, dt);
		post.u.dofFocus.value = camera.position.distanceTo(car.root.position);
		post.u.dofRange.value = cinema.dofRange;
		const tc = title.update(dt);
		post.u.title.value = tc.alpha;
		post.u.titleScale.value = tc.scale;
		// letterbox only on landscape screens: 2.39:1 bars would swallow most of a phone held upright
		post.u.letterbox.value = MathUtils.damp(post.u.letterbox.value, cinema.letterbox && camState.mode === 'cinematic' && camera.aspect > 1.2 ? 1 : 0, 4, dt);

		city.update(camera);
		const delta = city.maybeRebase(camera.position);
		if (delta) {
			archUniforms.origin.value.copy(city.origin);
			camera.position.sub(delta);
			director.rebase(delta);
			xr.rebase(delta);
			car.rebase(delta);
			rebaseViewProj(delta);
			renderPos.sub(delta);
			car.root.position.sub(delta);
			prevCar.sub(delta);
		}
		archUniforms.origin.value.copy(city.origin);
		const P = layout.pitch * 4;
		ground.position.set(Math.round(camera.position.x / P) * P, 0, Math.round(camera.position.z / P) * P);
		updateTraffic(camera, city.origin, layout.pitch);
		videos.update(dt);
		holoLayer.update(camera, city.origin, layout.pitch, values['Street Width'], !!delta);
		wires.update(camera, city.origin, layout.pitch, values['Street Width'], !!delta);
		holoArt.update(dt, camera, city.origin, layout.pitch, values['Street Width']);

		sky.update();
		if (vr) xr.render();
		else {
			post.render(dt);
			storeViewProj(camera);
			capture.afterRender();
			capture.tick();
		}

		// HUD
		fpsAcc += dt; fpsN++;
		if (fpsAcc > 0.5) {
			const { bx, by } = city.blockAt(car.root.position);
			hudSector = `${bx >= 0 ? '+' : ''}${bx}.${by >= 0 ? '+' : ''}${by}`;
			hudFps = Math.round(fpsN / fpsAcc);
			$('hud-sector').textContent = hudSector;
			$('hud-stats').textContent = `${hudFps} FPS${xr.presenting ? ' · VR' : ''}\n${city.stats.instances.toLocaleString()} GN INSTANCES · ${city.stats.drawCalls} DRAWS\nSEED ${values.Seed}`;
			fpsAcc = 0; fpsN = 0;
		}
		$('hud-speed').textContent = String(Math.round(Math.abs(fs.speed) * 3.6)).padStart(3, '0');
		$('hud-alt').textContent = String(Math.round(fs.alt)).padStart(3, '0');
	};

	// dynamic resolution: hold ~60 fps on whatever GPU the browser hands us
	const dyn = { acc: 0, n: 0, cooldown: 2 };
	const scaleCtl = gui.controllersRecursive().find((c) => c.object === quality && c.property === 'scale');
	renderer.setAnimationLoop(() => {
		timer.update();
		const raw = timer.getDelta();
		frame(Math.min(raw, 1 / 20));
		if (!quality.auto || capture.recording || xr.presenting) return;
		dyn.acc += raw; dyn.n++; dyn.cooldown -= raw;
		if (dyn.acc > 1.5 && dyn.cooldown <= 0) {
			const ms = (dyn.acc / dyn.n) * 1000, lo = Math.min(quality.min, quality.max);
			let sc = quality.scale;
			if (ms > 21) sc -= 0.1;
			else if (ms < 13) sc += 0.05;
			sc = +Math.min(Math.max(sc, lo), quality.max).toFixed(2);
			if (sc !== quality.scale) {
				quality.scale = sc;
				renderer.setPixelRatio(sc);
				scaleCtl?.updateDisplay();
			}
			dyn.acc = 0; dyn.n = 0; dyn.cooldown = 1;
		}
	});

	// dev helpers: deterministic stepping + PNG capture through the Vite /__shot endpoint
	const step = async (n = 1, dt = 1 / 60) => {
		const nf = renderer._nodes.nodeFrame;
		for (let i = 0; i < n; i++) {
			// tick the node frame ourselves: pass nodes render once per frame id, and rAF
			// (which normally advances it) is paused while the page is hidden
			nf.update();
			renderer.info.frame = nf.frameId;
			frame(dt);
		}
		await renderer.backend.device?.queue.onSubmittedWorkDone();
	};
	// Offscreen capture at any resolution (independent of the window / pane size).
	const shot = async (name = 'shot', warm = 2, w = 1600, h = 896) => {
		const rt = new RenderTarget(w, h, { type: UnsignedByteType, depthBuffer: false });
		const prevPR = renderer.getPixelRatio(), prevSize = renderer.getSize(new Vector2());
		renderer.setPixelRatio(1);
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		await step(warm);
		renderer.setRenderTarget(rt);
		renderer._nodes.nodeFrame.update();
		renderer.info.frame = renderer._nodes.nodeFrame.frameId;
		frame(1 / 60);
		renderer.setRenderTarget(null);
		const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
		rt.dispose();
		renderer.setPixelRatio(prevPR);
		renderer.setSize(prevSize.x, prevSize.y, false);
		camera.aspect = prevSize.x / prevSize.y;
		camera.updateProjectionMatrix();
		const oc = new OffscreenCanvas(w, h);
		const data = new Uint8ClampedArray(px.buffer, px.byteOffset, w * h * 4);
		for (let i = 3; i < data.length; i += 4) data[i] = 255;
		oc.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
		const blob = await oc.convertToBlob({ type: 'image/png' });
		await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
		return blob.size;
	};
	const contact = async (prefix = 'c', shots = ['chase', 'low', 'front', 'side', 'flyby', 'top', 'crane', 'orbit'], settle = 75) => {
		for (const sh of shots) {
			director.mode = 'cinematic';
			director._start(sh);
			director.shotLen = 1e9;
			await step(settle);
			await shot(`${prefix}_${sh}`, 1);
		}
	};
	if (xrBackend && !params.has('xremu') && isHeadsetBrowser()) $('hint').textContent = 'PRESS ◉ ENTER VR — TAKE THE WHEEL IN YOUR HEADSET';
	window.__app = { sky, xr, holoArt, renderer, scene, camera, city, layout, controls, ap, car, director, post, values, gui, applyLook, step, shot, frame, setMode, contact, videos, holoLayer, player, input, enterPilot, exitPilot };
}

main().catch((e) => {
	console.error(e);
	$('loader-msg').textContent = 'ERROR: ' + e.message;
});
