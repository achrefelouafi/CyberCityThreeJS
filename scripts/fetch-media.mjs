// Fetches and prepares the video media used by the holograms and LED billboards.
// Every source is public domain, CC0 or CC BY (attribution in media.json, the app
// credits overlay and the README). Requires ffmpeg on PATH.
//
//   npm run media                 download (if needed) + transcode to public/media
//   MEDIA_RAW=dir npm run media   reuse an existing download folder
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const RAW = process.env.MEDIA_RAW ?? join(tmpdir(), 'cybercity-media-raw');
const OUT = resolve(root, 'public/media');
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

const TOS = 'https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov';
const CREDIT_TOS = 'Tears of Steel (CC BY 3.0) Blender Foundation | mango.blender.org';
const SINTEL = 'https://download.blender.org/demo/movies/Sintel.2010.1080p.mkv';
const CREDIT_SINTEL = 'Sintel (CC BY 3.0) Blender Foundation | durian.blender.org';
const CREDIT_NOAA = 'NOAA Office of Ocean Exploration and Research (public domain), via Wikimedia Commons';

// raw sources ---------------------------------------------------------------------------
const SOURCES = {
	medusa: { url: 'https://upload.wikimedia.org/wikipedia/commons/9/9f/Okeanos_Explorer_PR_and_USVI_Dive_8-_Psychedelic_Medusa-NOAA-1280x720.webm', file: 'medusa.webm' },
	marianas: { url: 'https://upload.wikimedia.org/wikipedia/commons/c/c1/Jellyfish-_2016_Deepwater_Exploration_of_the_Marianas.webm', file: 'jelly_marianas.webm' },
	chukchi: { url: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Jellyfish_Species-_Hidden_Ocean_2016-_Chukchi_Borderlands.webm', file: 'jelly_chukchi.webm' },
	blackhole: { url: 'https://svs.gsfc.nasa.gov/vis/a010000/a013300/a013326/BH_AccretionDisk_Sim_360_Center_16x9_1080.webm', file: 'blackhole.webm' },
};

// outputs --------------------------------------------------------------------------------
// kind: 'holo' (square, keyed to black, additive) | 'screen' (16:9 billboard)
const CLIPS = [
	{ id: 'holo_medusa', kind: 'holo', src: 'medusa', ss: 44.2, t: 8, crop: 'crop=720:720:280:0', key: 'colorkey=0x004363:0.33:0.18', credit: CREDIT_NOAA + ' - "Psychedelic Medusa"' },
	{ id: 'holo_jelly_top', kind: 'holo', src: 'marianas', ss: 12.2, t: 8, crop: 'crop=1080:1080:420:0', levels: 'colorlevels=rimin=0.2:gimin=0.22:bimin=0.32:rimax=0.85:gimax=0.85:bimax=0.95,eq=saturation=1.5', credit: CREDIT_NOAA + ' - Jellyfish, Marianas 2016' },
	{ id: 'holo_jelly_bell', kind: 'holo', src: 'marianas', ss: 22.6, t: 8, crop: 'crop=1080:1080:420:0', levels: 'colorlevels=rimin=0.2:gimin=0.22:bimin=0.32:rimax=0.85:gimax=0.85:bimax=0.95,eq=saturation=1.5', credit: CREDIT_NOAA + ' - Jellyfish, Marianas 2016' },
	{ id: 'holo_atolla', kind: 'holo', src: 'chukchi', ss: 1.2, t: 7, crop: 'crop=720:720:280:0', levels: 'colorlevels=rimin=0.06:gimin=0.08:bimin=0.2:rimax=0.8:gimax=0.8:bimax=0.9,eq=saturation=1.5', credit: CREDIT_NOAA + ' - Hidden Ocean 2016' },
	{ id: 'screen_blackhole', kind: 'screen', src: 'blackhole', ss: 3.8, t: 8, crop: 'scale=640:360', credit: "NASA's Goddard Space Flight Center / Jeremy Schnittman" },
	{ id: 'screen_tos_holo', kind: 'screen', tos: 41.5, t: 8, credit: CREDIT_TOS },
	{ id: 'screen_tos_brain', kind: 'screen', tos: 61, t: 8, credit: CREDIT_TOS },
	{ id: 'screen_tos_ship', kind: 'screen', tos: 103, t: 8, credit: CREDIT_TOS },
	{ id: 'screen_tos_hacker', kind: 'screen', tos: 416, t: 8, credit: CREDIT_TOS },
	{ id: 'screen_tos_eye', kind: 'screen', tos: 556, t: 8, credit: CREDIT_TOS },
	{ id: 'screen_sintel_dragon', kind: 'screen', movie: SINTEL, at: 326, t: 8, credit: CREDIT_SINTEL },
	{ id: 'screen_sintel_face', kind: 'screen', movie: SINTEL, at: 71, t: 7, credit: CREDIT_SINTEL },
	{ id: 'screen_sintel_city', kind: 'screen', movie: SINTEL, at: 178, t: 7, credit: CREDIT_SINTEL },
];

const run = (args) => {
	const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
	if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' '));
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function fetchRaw(key) {
	const s = SOURCES[key];
	const p = join(RAW, s.file);
	if (!existsSync(p)) {
		console.log('download', s.url);
		const r = spawnSync('curl', ['-sSL', '-A', 'CyberCityThreeJS-media/1.0', '-o', p, s.url], { stdio: 'inherit' });
		if (r.status !== 0) throw new Error('download failed ' + s.url);
	}
	return p;
}

function excerpt(url, tag, t0, dur) {
	const p = join(RAW, `${tag}_${t0}.mp4`);
	if (!existsSync(p)) {
		console.log(`excerpt ${tag} @${t0}s (HTTP range read)`);
		// download.blender.org rate-limits bursts (429): back off and retry
		for (let attempt = 0; ; attempt++) {
			const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t0), '-t', String(dur + 0.5), '-i', url, '-an', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', p], { stdio: 'inherit' });
			if (r.status === 0) break;
			if (attempt >= 6) throw new Error('excerpt failed ' + url);
			sleep(30000 * (attempt + 1));
		}
		sleep(15000);
	}
	return p;
}
const tosExcerpt = (t0, dur) => excerpt(TOS, 'tos', t0, dur);

const meta = [];
for (const c of CLIPS) {
	const out = join(OUT, `${c.id}.mp4`);
	const fade = `fade=t=in:st=0:d=0.35,fade=t=out:st=${c.t - 0.35}:d=0.35`;
	let input, vf;
	if (c.tos !== undefined) {
		input = ['-i', tosExcerpt(c.tos, c.t)];
		vf = `crop=950:534:165:0,scale=640:360,${fade}`; // 2.4:1 (1280x534) -> 16:9 centre crop
	} else if (c.movie) {
		input = ['-i', excerpt(c.movie, 'sintel', c.at, c.t)];
		vf = `crop=ih*16/9:ih,scale=640:360,${fade}`; // 2.35:1 -> 16:9 centre crop
	} else if (c.kind === 'holo') {
		input = ['-ss', String(c.ss), '-t', String(c.t), '-i', fetchRaw(c.src)];
		const look = c.key ? `${c.key},format=yuva420p` : c.levels;
		vf = c.key
			? `[0:v]${c.crop},scale=512:512,${look}[fg];color=black:s=512x512:d=${c.t}[bg];[bg][fg]overlay=shortest=1,${fade}`
			: `${c.crop},scale=512:512,${look},${fade}`;
	} else {
		input = ['-ss', String(c.ss), '-t', String(c.t), '-i', fetchRaw(c.src)];
		vf = `${c.crop},${fade}`;
	}
	const filterArg = vf.includes('[') ? ['-filter_complex', vf] : ['-vf', vf];
	run([...input, ...filterArg, '-t', String(c.t), '-an', '-r', '30', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '25', '-preset', 'slow', '-movflags', '+faststart', out]);
	meta.push({ id: c.id, kind: c.kind, file: `media/${c.id}.mp4`, seconds: c.t, credit: c.credit, bytes: statSync(out).size });
	console.log('wrote', out, (statSync(out).size / 1024).toFixed(0) + ' KB');
}
writeFileSync(join(OUT, 'media.json'), JSON.stringify({ clips: meta }, null, 1));
console.log(`\n${meta.length} clips, ${(meta.reduce((a, m) => a + m.bytes, 0) / 1048576).toFixed(1)} MB -> public/media`);
