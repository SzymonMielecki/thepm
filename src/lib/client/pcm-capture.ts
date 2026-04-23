/**
 * Browser mic → mono 16 kHz PCM s16le for ElevenLabs Scribe Realtime.
 * Uses ScriptProcessor (no worklet) for broad mobile Safari + Chrome support.
 */
export type PcmCapture = { stop: () => void };

const TARGET_HZ = 16000;
const CHUNK_SAMPLES = 4096; // ~256 ms at 16 kHz, within typical streaming limits
const WAVE_BARS = 20;
const WAVE_MIN_MS = 55; // ~18 Hz; keeps WS + hub SSE light

/**
 * Per-bar energy from live mono float samples (e.g. pre-resample) for a simple “waveform” strip.
 */
function levelsFromMonoF32(m: Float32Array, bars: number): number[] {
	if (m.length === 0 || bars < 1) return Array(bars).fill(0);
	const w = m.length / bars;
	const out: number[] = [];
	for (let b = 0; b < bars; b++) {
		const from = Math.floor(b * w);
		const to = Math.floor((b + 1) * w);
		let s = 0;
		let mPeak = 0;
		for (let i = from; i < to; i++) {
			const v = m[i] ?? 0;
			s += v * v;
			const a = Math.abs(v);
			if (a > mPeak) mPeak = a;
		}
		const rms = Math.sqrt(s / Math.max(1, to - from));
		out.push(Math.min(1, rms * 2.2 + mPeak * 0.7));
	}
	return out;
}

function cat16(a: Int16Array, b: Int16Array): Int16Array {
	if (a.length === 0) return b;
	if (b.length === 0) return a;
	const c = new Int16Array(a.length + b.length);
	c.set(a, 0);
	c.set(b, a.length);
	return c;
}

function resampleF32(input: Float32Array, inRate: number, outRate: number): Float32Array {
	if (inRate === outRate) return input;
	const ratio = inRate / outRate;
	const outLen = Math.max(0, Math.floor(input.length / ratio));
	const out = new Float32Array(outLen);
	for (let i = 0; i < outLen; i++) {
		const x = i * ratio;
		const j = Math.floor(x);
		const f = x - j;
		const a = input[j] ?? 0;
		const b = input[Math.min(j + 1, input.length - 1)] ?? a;
		out[i] = a + f * (b - a);
	}
	return out;
}

function f32ToI16le(f: Float32Array): Int16Array {
	const o = new Int16Array(f.length);
	for (let i = 0; i < f.length; i++) {
		const s = Math.max(-1, Math.min(1, f[i] ?? 0));
		o[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
	}
	return o;
}

function i16ToBase64(i: Int16Array): string {
	const u8 = new Uint8Array(i.buffer, i.byteOffset, i.byteLength);
	let binary = '';
	const bl = 0x4000;
	for (let o = 0; o < u8.length; o += bl) {
		const s = u8.subarray(o, o + bl);
		binary += String.fromCharCode.apply(null, s as unknown as number[]);
	}
	return btoa(binary);
}

/**
 * @param onChunk Base64 of raw PCM s16le little-endian at 16 kHz
 * @param onWaveform Optional bar levels 0..1 for a live level meter (throttled, ~18/s).
 */
export async function startPcm16kCapture(
	stream: MediaStream,
	onChunk: (base64: string) => void,
	onWaveform?: (levels: number[]) => void
): Promise<PcmCapture> {
	const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
	if (!Ctx) {
		throw new Error('AudioContext not available');
	}
	const context = new Ctx({ sampleRate: 16000 });
	if (context.state === 'suspended') {
		await context.resume();
	}
	const inRate = context.sampleRate;
	const source = context.createMediaStreamSource(stream);
	const bufferSize = 4096;
	// Two inputs: capture stereo mics; we downmix in software.
	const proc = context.createScriptProcessor(bufferSize, 2, 1);
	const gain = context.createGain();
	gain.gain.value = 0;
	let acc = new Int16Array(0);
	let lastWave = 0;

	proc.onaudioprocess = (e) => {
		const input = e.inputBuffer;
		const n = input.length;
		const ch0 = input.getChannelData(0);
		const ch1 = input.numberOfChannels > 1 ? input.getChannelData(1) : null;
		const mono = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const a = ch0[i] ?? 0;
			const b = ch1 ? (ch1[i] ?? 0) : a;
			mono[i] = ch1 ? (a + b) * 0.5 : a;
		}
		if (onWaveform) {
			const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
			if (now - lastWave >= WAVE_MIN_MS) {
				lastWave = now;
				onWaveform(levelsFromMonoF32(mono, WAVE_BARS));
			}
		}
		const f16 = resampleF32(mono, inRate, TARGET_HZ);
		const i16 = f32ToI16le(f16);
		acc = cat16(acc, i16);
		while (acc.length >= CHUNK_SAMPLES) {
			const part = acc.subarray(0, CHUNK_SAMPLES);
			onChunk(i16ToBase64(part));
			acc = acc.length > CHUNK_SAMPLES ? acc.subarray(CHUNK_SAMPLES) : new Int16Array(0);
		}
	};

	source.connect(proc);
	proc.connect(gain);
	gain.connect(context.destination);

	return {
		stop: () => {
			proc.onaudioprocess = null;
			if (acc.length > 0) {
				onChunk(i16ToBase64(acc));
				acc = new Int16Array(0);
			}
			try {
				source.disconnect();
			} catch {
				// ignore
			}
			try {
				proc.disconnect();
			} catch {
				// ignore
			}
			try {
				gain.disconnect();
			} catch {
				// ignore
			}
			for (const t of stream.getTracks()) t.stop();
			void context.close();
		}
	};
}
