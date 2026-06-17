/**
 * ============================================================
 *  VOICEVOX 読み上げ音声生成プロキシ
 * ------------------------------------------------------------
 *  フロントから { text, speakerId, params? } を受け取り、
 *  VOICEVOX ENGINE で WAV 音声を生成して返します。
 *
 *  処理の流れ (VOICEVOX 公式の流れに沿う):
 *    1. POST /audio_query?text=...&speaker=...   → audio_query(JSON)
 *    2. audio_query の各種スケール値を調整 (うぃるくん用に少し明るく)
 *    3. POST /synthesis?speaker=...              → wav(バイナリ)
 *
 *  ※ VOICEVOX ENGINE が起動していない場合は 503 を返します。
 *    フロントはそれを見て、標準音声(SpeechSynthesis)に自動フォールバックします。
 * ============================================================
 */

import { NextRequest, NextResponse } from "next/server";
import { sanitizeForVoicevox } from "@/lib/voicevoxText";

const VOICEVOX_ENGINE_URL =
  process.env.VOICEVOX_ENGINE_URL ?? "http://127.0.0.1:50021";
const DEFAULT_SPEAKER_ID = Number(
  process.env.VOICEVOX_DEFAULT_SPEAKER_ID ?? 3
);

/**
 * うぃる用の音声パラメータ既定値。
 * 「ほんの少し明るく・聞き取りやすく」を目安に、
 * 不自然にならない範囲で控えめに調整しています。
 */
const DEFAULT_AUDIO_PARAMS = {
  speedScale: 1.05,      // 話速 (1.0 = 標準)。少しだけテキパキ
  pitchScale: 0.0,       // ピッチ (0 = 標準)。ずんだもんは高めなので動かさない
  intonationScale: 1.15, // 抑揚 (1.0 = 標準)。少し豊かに、でも過剰にしない
  volumeScale: 1.0,      // 音量 (1.0 = 標準)
  prePhonemeLength: 0.1, // 発話前の無音
  postPhonemeLength: 0.2, // 発話後の無音 (語尾の余韻)
};

type AudioParamsInput = Partial<typeof DEFAULT_AUDIO_PARAMS>;

/** 安全レンジで値をクランプ */
function clamp(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export async function POST(req: NextRequest) {
  let text = "";
  let speakerId = DEFAULT_SPEAKER_ID;
  let paramsIn: AudioParamsInput = {};

  try {
    const body = (await req.json()) as {
      text?: string;
      speakerId?: number;
      params?: AudioParamsInput;
    };
    text = (body.text ?? "").trim();
    speakerId =
      typeof body.speakerId === "number" && Number.isFinite(body.speakerId)
        ? body.speakerId
        : DEFAULT_SPEAKER_ID;
    paramsIn = body.params ?? {};
  } catch {
    return NextResponse.json(
      { error: "リクエスト本文を解釈できませんでした。" },
      { status: 400 }
    );
  }

  if (!text) {
    return NextResponse.json(
      { error: "text は必須です。" },
      { status: 400 }
    );
  }

  // VOICEVOX 専用の読み補正を適用(表示テキストは変えない、送信テキストだけ補正)
  const correctedText = sanitizeForVoicevox(text);

  // 長文ガード (VOICEVOX に投げすぎないよう軽く制限)
  const MAX_LEN = 400;
  const safeText =
    correctedText.length > MAX_LEN ? correctedText.slice(0, MAX_LEN) : correctedText;

  // パラメータをクランプして安全に
  const params = {
    speedScale: clamp(paramsIn.speedScale, DEFAULT_AUDIO_PARAMS.speedScale, 0.5, 2.0),
    pitchScale: clamp(paramsIn.pitchScale, DEFAULT_AUDIO_PARAMS.pitchScale, -0.15, 0.15),
    intonationScale: clamp(
      paramsIn.intonationScale,
      DEFAULT_AUDIO_PARAMS.intonationScale,
      0.0,
      2.0
    ),
    volumeScale: clamp(paramsIn.volumeScale, DEFAULT_AUDIO_PARAMS.volumeScale, 0.0, 2.0),
    prePhonemeLength: clamp(
      paramsIn.prePhonemeLength,
      DEFAULT_AUDIO_PARAMS.prePhonemeLength,
      0.0,
      1.5
    ),
    postPhonemeLength: clamp(
      paramsIn.postPhonemeLength,
      DEFAULT_AUDIO_PARAMS.postPhonemeLength,
      0.0,
      1.5
    ),
  };

  try {
    // 1) audio_query
    const queryRes = await fetch(
      `${VOICEVOX_ENGINE_URL}/audio_query?text=${encodeURIComponent(
        safeText
      )}&speaker=${speakerId}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!queryRes.ok) {
      return NextResponse.json(
        {
          error: `VOICEVOX /audio_query が ${queryRes.status} を返しました。speakerId をご確認ください。`,
        },
        { status: 502 }
      );
    }
    const audioQuery = (await queryRes.json()) as Record<string, unknown>;

    // audio_query にうぃる用パラメータを上書き
    audioQuery.speedScale = params.speedScale;
    audioQuery.pitchScale = params.pitchScale;
    audioQuery.intonationScale = params.intonationScale;
    audioQuery.volumeScale = params.volumeScale;
    audioQuery.prePhonemeLength = params.prePhonemeLength;
    audioQuery.postPhonemeLength = params.postPhonemeLength;

    // 2) synthesis
    const synthRes = await fetch(
      `${VOICEVOX_ENGINE_URL}/synthesis?speaker=${speakerId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/wav",
        },
        body: JSON.stringify(audioQuery),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!synthRes.ok) {
      return NextResponse.json(
        {
          error: `VOICEVOX /synthesis が ${synthRes.status} を返しました。`,
        },
        { status: 502 }
      );
    }

    const wav = await synthRes.arrayBuffer();
    return new NextResponse(wav, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "VOICEVOX ENGINE に接続できません。VOICEVOX を起動しているかご確認ください。",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}
