// Assemble the social cut from the rendered clips.
//
//   node video/lib/master.mjs                    concat what's in video/out
//   node video/lib/master.mjs --render           (re)render every clip first (~40 min)
//   node video/lib/master.mjs --render 03_chase  re-render just these clips, then concat
//   node video/lib/master.mjs --music track.mp3  lay a soundtrack under the full cut (fades out)
//
// Outputs (video/out): 00_split.mp4 (composited opening), hook.mp4, body.mp4, neo-kyoto.mp4
// Final encode targets X/Twitter: H.264 High 4.2, yuv420p, 1080p60, <= 25 Mbps, AAC 192k.
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'out');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
// the opening is a composite: 00a (seed panel, left half) slid out over 00b (the dive)
export const OPENING = ['00a_seeds_panel', '00b_dive'];
export const HOOK = ['00_split', '01b_flyby', '01c_blender'];
// 05_seeds is left out since the opening shows the regeneration (add it back here if wanted)
export const BODY = ['02_title', '03_chase', '04_cockpit', '06_holo', '07_scale', '08_outro'];
const SPLIT = { t0: 3.5, t1: 4.0 }; // keep in sync with K.SPLIT in kit.js

const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true; };
const run = (cmd, args) => {
	const r = spawnSync(cmd, args, { stdio: 'inherit' });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
};

if (flag('render')) {
	const only = argv.filter((a) => !a.startsWith('--') && [...OPENING, ...HOOK, ...BODY].includes(a));
	const all = [...OPENING, ...HOOK.filter((c) => c !== '00_split'), ...BODY];
	for (const c of only.length ? only : all) run(process.execPath, [resolve(HERE, 'render.mjs'), c]);
}

// opening: the seed panel slides out to the left on the same inOutCubic curve the dive's lens uses
{
	const u = `clip((t-${SPLIT.t0})/${SPLIT.t1 - SPLIT.t0},0,1)`;
	const ease = `if(lt(${u},0.5),4*pow(${u},3),1-pow(2-2*${u},3)/2)`;
	run(FFMPEG, ['-y', '-loglevel', 'error', '-i', resolve(OUT, '00b_dive.mp4'), '-i', resolve(OUT, '00a_seeds_panel.mp4'),
		'-filter_complex', `[0][1]overlay=x='-960*(${ease})':y=0:eof_action=pass:eval=frame`,
		'-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '60', resolve(OUT, '00_split.mp4')]);
	console.log('-> video/out/00_split.mp4');
}

const duration = (f) => +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.toString().trim();

const concat = (clips, name, music = null) => {
	const missing = clips.filter((c) => !existsSync(resolve(OUT, `${c}.mp4`)));
	if (missing.length) throw new Error(`render these first: ${missing.join(', ')}`);
	const total = clips.reduce((a, c) => a + duration(resolve(OUT, `${c}.mp4`)), 0);
	const list = resolve(OUT, `${name}.txt`);
	writeFileSync(list, clips.map((c) => `file '${resolve(OUT, `${c}.mp4`).replace(/\\/g, '/')}'`).join('\n'));
	const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
	if (music) args.push('-i', music);
	args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-maxrate', '25M', '-bufsize', '50M',
		'-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-r', '60', '-movflags', '+faststart');
	if (music) args.push('-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-af', `afade=t=out:st=${(total - 1.7).toFixed(2)}:d=1.7`, '-shortest');
	args.push(resolve(OUT, `${name}.mp4`));
	run(FFMPEG, args);
	console.log(`-> video/out/${name}.mp4`);
};

concat(HOOK, 'hook');
concat(BODY, 'body');
concat([...HOOK, ...BODY], 'neo-kyoto', flag('music') === true ? null : flag('music'));
