import { NextRequest, NextResponse } from "next/server";

const MODEL = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const VOICE = process.env.OPENAI_TTS_VOICE ?? "marin";
const MAX_TEXT_LENGTH = 1800;
const DEFAULT_INSTRUCTIONS =
  "Speak in natural Japanese as WILL.tennis official character うぃる. " +
  "Bright, friendly, gentle, clear, and slightly energetic for guiding a tennis group. " +
  "Do not sound childish or exaggerated. Keep pauses natural and concise. " +
  "Pronounce WILL.tennis as ウィルテニス.";

function isSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.nextUrl.host;
  } catch {
    return false;
  }
}

export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: MODEL,
    voice: VOICE,
  });
}
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OpenAI TTS is not configured" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const text =
    typeof body === "object" &&
    body !== null &&
    "text" in body &&
    typeof body.text === "string"
      ? body.text.trim()
      : "";

  if (!text || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `text must be 1-${MAX_TEXT_LENGTH} characters` },
      { status: 400 },
    );
  }
  const instructions =
    process.env.OPENAI_TTS_INSTRUCTIONS ?? DEFAULT_INSTRUCTIONS;
  const voice = VOICE.startsWith("voice_") ? { id: VOICE } : VOICE;

  try {
    const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        voice,
        input: text,
        instructions,
        response_format: "wav",
      }),
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      console.error("[/api/openai/tts] upstream error", upstream.status);
      return NextResponse.json(
        { error: "OpenAI TTS request failed" },
        { status: 502 },
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[/api/openai/tts] request error", error);
    return NextResponse.json(
      { error: "OpenAI TTS request failed" },
      { status: 502 },
    );
  }
}
