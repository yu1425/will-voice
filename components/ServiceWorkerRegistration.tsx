"use client";
import { useEffect } from "react";
import { registerFlowAudioWorker } from "@/lib/offlineFlowAudio";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    void registerFlowAudioWorker();
  }, []);
  return null;
}
