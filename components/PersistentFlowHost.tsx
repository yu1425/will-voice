"use client";

import { usePathname } from "next/navigation";
import WillVoiceApp from "@/components/WillVoiceApp";

/**
 * Keeps the flow runtime mounted across App Router navigation.
 * The flow UI is merely hidden off-route, so its clock, timers and media
 * continue while HOME / Chat / Settings / Guide are visible.
 */
export default function PersistentFlowHost({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const flowVisible = pathname === "/flow";

  return (
    <>
      <div hidden={!flowVisible} aria-hidden={!flowVisible}>
        <WillVoiceApp
          mode="flow"
          persistentFlow
          flowRouteActive={flowVisible}
        />
      </div>
      {!flowVisible && children}
    </>
  );
}
