import {
  FLOW_AUDIO_CACHE,
  getOfflineFlowAudioUrls,
} from "@/lib/offlineFlowAudio";

export function GET() {
  return Response.json({
    cacheName: FLOW_AUDIO_CACHE,
    urls: getOfflineFlowAudioUrls(),
  });
}
