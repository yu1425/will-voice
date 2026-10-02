import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const ROOT = process.cwd();
const OUTPUT_DIR = join(ROOT, 'public/audio/flow/v2');
const REPORT = join(ROOT, 'reports/flow-background-timeline-audit.json');
const DURATION_SEC = 7200;
const SAMPLE_RATE = 48000;
const VOICE_DELAY_MS = 3550;
const definitions = JSON.parse(readFileSync(join(ROOT, 'lib/flowScripts.json'), 'utf8'));

function pickVariant(event, courts) {
  return event.variants.find((v) => v.courtMode === 'both' || v.courtMode === (courts === 2 ? 'double' : 'single'));
}

function writeWav(path, samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buffer);
}

function generateChime(path) {
  const duration = 2.95;
  const samples = new Float64Array(Math.ceil(duration * SAMPLE_RATE));
  const strikes = [
    { frequency: 659.25, at: 0, tail: 1.7 },
    { frequency: 830.61, at: 0.48, tail: 1.8 },
    { frequency: 987.77, at: 0.96, tail: 1.9 },
  ];
  const partials = [
    { ratio: 1, gain: 0.13, tailScale: 1 },
    { ratio: 2.01, gain: 0.04, tailScale: 0.72 },
    { ratio: 2.98, gain: 0.016, tailScale: 0.52 },
  ];
  for (const strike of strikes) {
    for (const partial of partials) {
      const start = Math.round(strike.at * SAMPLE_RATE);
      const tail = strike.tail * partial.tailScale;
      const end = Math.min(samples.length, start + Math.ceil(tail * SAMPLE_RATE));
      for (let i = start; i < end; i++) {
        const t = (i - start) / SAMPLE_RATE;
        const attack = Math.min(1, t / 0.018);
        const decay = Math.exp(-7 * Math.max(0, t - 0.018) / Math.max(0.001, tail - 0.018));
        const env = Math.max(0.0001, attack * decay);
        samples[i] += Math.sin(2 * Math.PI * strike.frequency * partial.ratio * t) * partial.gain * env;
      }
    }
  }
  writeWav(path, samples, SAMPLE_RATE);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function ffprobeDuration(path) {
  const p = spawnSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', path], { encoding: 'utf8' });
  if (p.status !== 0) throw new Error(p.stderr || 'ffprobe failed');
  return Number(p.stdout.trim());
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const tempChime = join(OUTPUT_DIR, '.timeline-chime.tmp.wav');
generateChime(tempChime);
const report = { generatedAt: new Date().toISOString(), durationSec: DURATION_SEC, voiceDelayMs: VOICE_DELAY_MS, files: [] };

for (const courts of [1, 2]) {
  for (const chimeEnabled of [false, true]) {
    const outputName = `background-timeline-${courts}court-${chimeEnabled ? 'chime' : 'plain'}.m4a`;
    const outputPath = join(OUTPUT_DIR, outputName);
    const inputs = [];
    const delays = [];
    for (const event of definitions) {
      const variant = pickVariant(event, courts);
      if (!variant?.audioSrc) continue;
      const voicePath = join(ROOT, 'public', variant.audioSrc);
      const useChime = chimeEnabled && event.id !== 'opening' && event.chime !== false;
      if (useChime) {
        inputs.push(tempChime);
        delays.push(event.offsetSec * 1000);
      }
      inputs.push(voicePath);
      delays.push(event.offsetSec * 1000 + (useChime ? VOICE_DELAY_MS : 0));
    }

    const args = ['-y','-v','error','-f','lavfi','-t',String(DURATION_SEC),'-i',`anullsrc=r=${SAMPLE_RATE}:cl=mono`];
    for (const input of inputs) args.push('-i', input);
    const filters = ['[0:a]volume=1[base]'];
    const labels = ['[base]'];
    inputs.forEach((_, index) => {
      const label = `a${index + 1}`;
      filters.push(`[${index + 1}:a]adelay=${delays[index]}:all=1[${label}]`);
      labels.push(`[${label}]`);
    });
    filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:normalize=0,atrim=duration=${DURATION_SEC}[out]`);
    args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'aac', '-q:a', '1', '-movflags', '+faststart', '-t', String(DURATION_SEC), outputPath);
    const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`ffmpeg failed for ${outputName}`);
    report.files.push({
      courts,
      chimeEnabled,
      src: `/audio/flow/v2/${outputName}`,
      bytes: statSync(outputPath).size,
      durationSec: ffprobeDuration(outputPath),
      sha256: sha256(outputPath),
    });
    console.log(`${outputName} ${(statSync(outputPath).size / 1024 / 1024).toFixed(2)} MiB`);
  }
}
rmSync(tempChime, { force: true });
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
