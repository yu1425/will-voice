/**
 * ============================================================
 *  VOICEVOX 話者一覧プロキシ
 * ------------------------------------------------------------
 *  ローカル(あるいは別サーバー)で動いている VOICEVOX ENGINE の
 *  `/speakers` をそのまま中継します。フロントから直接 ENGINE を
 *  呼ばないことで、CORS や接続先の差し替えをサーバー側に集約します。
 *
 *  ずんだもんの speaker id を確認したいときは、
 *      GET /api/voicevox/speakers
 *  をブラウザで開けば、利用可能な話者の一覧が JSON で返ります。
 *
 *  ※ VOICEVOX ENGINE が起動していない場合は 503 を返し、
 *    フロント側はそれを見て「標準音声にフォールバック」します。
 * ============================================================
 */

import { NextResponse } from "next/server";

const VOICEVOX_ENGINE_URL =
  process.env.VOICEVOX_ENGINE_URL ?? "http://127.0.0.1:50021";

export async function GET() {
  try {
    const res = await fetch(`${VOICEVOX_ENGINE_URL}/speakers`, {
      // ENGINE が落ちているときに待ちすぎないよう、短めのタイムアウト
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `VOICEVOX ENGINE が ${res.status} を返しました。` },
        { status: 502 }
      );
    }

    const speakers = await res.json();
    return NextResponse.json({
      engineUrl: VOICEVOX_ENGINE_URL,
      defaultSpeakerId: Number(process.env.VOICEVOX_DEFAULT_SPEAKER_ID ?? 3),
      speakers,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "VOICEVOX ENGINE に接続できません。アプリ(VOICEVOX)を起動しているかご確認ください。",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}
