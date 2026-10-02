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
const extras = process.argv.includes("--extras");
const sourcePath = extras ? "lib/flowCues.json" : "lib/flowScripts.json";
const reportPath = extras
  ? "reports/flow-extras-audio-audit.json"
  : "reports/flow-audio-v2-audit.json";
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const previous = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8"))
  : null;
if (existsSync(reportPath) && !process.argv.includes("--replace"))
  throw Error("Audit exists; review before using --replace");
if (only && !previous)
  throw Error("Partial regeneration requires an existing audit");
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
  if (!style || style.id !== 3)
    throw Error("ずんだもん・ノーマル styleId 3 not found");
  const definitions = JSON.parse(readFileSync(sourcePath, "utf8"));
  const sources = extras
    ? definitions.map((cue) => ({ ...cue, courtMode: "both", offsetSec: null }))
    : definitions.flatMap((e) =>
        e.variants.map((v) => ({ ...v, id: e.id, offsetSec: e.offsetSec })),
      );
  if (!extras)
    sources.push({
      id: "voice-test",
      courtMode: "both",
      offsetSec: null,
      displayText: "音声テストです。聞こえ方をご確認ください。",
      audioSrc: "/audio/flow/v2/voice-test.wav",
    });
  const selected = only
    ? sources.filter((source) => source.id === only)
    : sources;
  if (!selected.length) throw Error("Unknown source: " + only);
  if (only && (previous.styleId !== style.id || previous.engine !== engine))
    throw Error(
      "Partial regeneration must use the original speaker and engine",
    );
  const audited = [];
  for (const source of selected) {
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
      ["ちかくのかた", "チカクノカタ"],
      ["はじめて参加されるかた", "ハジメテサンカサレルカタ"],
      ["ペアになったかた", "ペアニナッタカタ"],
      ["ごふん", "ゴフン"],
      ["にふんかん", "ニフンカン"],
      ["まっているかた", "マッテイルカタ"],
      ["こうたい", "コ[ウオー]タイ"],
      ["きょうだ", "キョ[ウオー]ダ"],
      ["すいぶんほきゅう", "スイブンホキュ[ウー]"],
      ["しゅうごう", "シュ[ウー]ゴ[ウオー]"],
      ["うんえい", "ウンエイ"],
      ["かためん", "カタメン"],
      ["すうめい", "スウメイ"],
      ["こえをかけられたひと", "コエオカケラレタヒト"],
      ["いどう", "イド[ウオー]"],
      ["はじめて参加のかた", "ハジメテサンカノカタ"],
      ["いちど", "イチド"],
      ["次のメニュー", "ツギノメニュ[ウー]"],
      ["時間になりました", "ジカンニナリマシタ"],
      ["むりせず", "ムリセズ"],
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
    if (!(durationSec > (extras ? 1 : 3) && durationSec < 90))
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
      generatedAt: new Date().toISOString(),
    });
    console.log(`${source.id} ${source.courtMode}: ${durationSec.toFixed(2)}s`);
  }
  mkdirSync("reports", { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        ...(only ? previous : {}),
        generatedAt: only ? previous.generatedAt : new Date().toISOString(),
        ...(only
          ? { updatedAt: new Date().toISOString(), regeneratedIds: [only] }
          : {}),
        engine,
        engineVersion: await fetch(engine + "/version").then((r) => r.json()),
        speaker: speaker.name,
        style: style.name,
        styleId: style.id,
        source: sourcePath,
        normalizer: "lib/voicevoxText.ts",
        files: only
          ? previous.files.map(
              (file) =>
                audited.find((entry) => entry.audioSrc === file.audioSrc) ??
                file,
            )
          : audited,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
