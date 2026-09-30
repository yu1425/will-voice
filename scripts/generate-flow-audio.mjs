// Reproducible generation: canonical display text -> shared normalizer -> ENGINE -> WAV.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const engine = process.env.VOICEVOX_ENGINE_URL ?? "http://127.0.0.1:50021";
const reportPath = "reports/flow-audio-v2-audit.json";
if (existsSync(reportPath) && !process.argv.includes("--replace"))
  throw Error("Audit exists; review before using --replace");
const temp = mkdtempSync(join(tmpdir(), "will-flow-normalizer-"));
try {
  execFileSync("node", [
    "node_modules/typescript/bin/tsc",
    "lib/voicevoxText.ts",
    "--outDir",
    temp,
    "--module",
    "commonjs",
    "--target",
    "ES2020",
    "--skipLibCheck",
  ]);
  const { sanitizeForVoicevox } = createRequire(import.meta.url)(
    join(temp, "voicevoxText.js"),
  );
  const speakers = await fetch(engine + "/speakers").then((r) => {
    if (!r.ok) throw Error("ENGINE unavailable");
    return r.json();
  });
  const speaker = speakers.find((s) => s.name === "ずんだもん");
  const style = speaker?.styles.find((s) => s.name === "ノーマル");
  if (!style) throw Error("ずんだもん・ノーマル not found");
  const definitions = JSON.parse(readFileSync("lib/flowScripts.json", "utf8"));
  const sources = definitions.flatMap((e) =>
    e.variants.map((v) => ({ ...v, id: e.id, offsetSec: e.offsetSec })),
  );
  sources.push({
    id: "voice-test",
    courtMode: "both",
    offsetSec: null,
    displayText: "音声テストです。聞こえ方をご確認ください。",
    audioSrc: "/audio/flow/v2/voice-test.wav",
  });
  const audited = [];
  for (const source of sources) {
    const voiceText = sanitizeForVoicevox(source.displayText);
    if (
      /WILL|乱数表|4ポイント先取|[123]球|[123]本|2人|1列|(?<!聞こえ)方/.test(
        voiceText,
      )
    )
      throw Error("Unnormalized text: " + source.id);
    const queryResponse = await fetch(
      `${engine}/audio_query?text=${encodeURIComponent(voiceText)}&speaker=${style.id}`,
      { method: "POST" },
    );
    if (!queryResponse.ok) throw Error("audio_query: " + queryResponse.status);
    const query = await queryResponse.json();
    // Concatenate moras for reading assertions; kana also preserves actual accent marks.
    const reading = query.accent_phrases
      .flatMap((p) => p.moras.map((m) => m.text))
      .join("");
    const expected = [
      ["ウィルテニス", "ウィルテニス"],
      ["らんすうひょう", "ランス[ウー]ヒョ[ウー]"],
      ["よんポイントせんしゅ", "ヨンポイントセンシュ"],
      ["ふたり", "フタリ"],
      ["さんきゅう", "サンキュ[ウー]"],
      ["いちれつ", "イチレツ"],
      ["にほん", "ニホン"],
      ["さんぼん", "サンボン"],
    ];
    const readingChecks = expected
      .filter(([text]) => voiceText.includes(text))
      .map(([text, kana]) => ({
        text,
        kana,
        pass: new RegExp(kana).test(reading),
      }));
    if (readingChecks.some((c) => !c.pass))
      throw Error(JSON.stringify({ id: source.id, reading, readingChecks }));
    query.speedScale = 1;
    query.volumeScale = 1;
    query.prePhonemeLength = 0.1;
    query.postPhonemeLength = 0.25;
    const response = await fetch(`${engine}/synthesis?speaker=${style.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
    if (!response.ok) throw Error("synthesis: " + response.status);
    const wav = Buffer.from(await response.arrayBuffer());
    if (
      wav.toString("ascii", 0, 4) !== "RIFF" ||
      wav.toString("ascii", 8, 12) !== "WAVE"
    )
      throw Error("Not WAV");
    let byteRate = 0,
      dataSize = 0;
    for (let p = 12; p + 8 <= wav.length;) {
      const size = wav.readUInt32LE(p + 4);
      const id = wav.toString("ascii", p, p + 4);
      if (id === "fmt ") byteRate = wav.readUInt32LE(p + 16);
      if (id === "data") dataSize = size;
      p += 8 + size + (size % 2);
    }
    const durationSec = dataSize / byteRate;
    if (!(durationSec > 3 && durationSec < 90))
      throw Error("Unexpected duration " + durationSec);
    const path = "public" + source.audioSrc;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, wav);
    audited.push({
      ...source,
      voiceText,
      speaker: speaker.name,
      style: style.name,
      styleId: style.id,
      speakerUuid: speaker.speaker_uuid,
      file: path,
      bytes: wav.length,
      durationSec,
      kana: query.kana,
      accentPhrases: query.accent_phrases,
      readingChecks,
    });
    console.log(`${source.id} ${source.courtMode}: ${durationSec.toFixed(2)}s`);
  }
  mkdirSync("reports", { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        engine,
        engineVersion: await fetch(engine + "/version").then((r) => r.json()),
        speaker: speaker.name,
        style: style.name,
        styleId: style.id,
        source: "lib/flowScripts.json",
        normalizer: "lib/voicevoxText.ts",
        files: audited,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
