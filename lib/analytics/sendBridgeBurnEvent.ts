import type { BridgeBurnEventInput } from "@/lib/analytics/bridgeBurnEvent";

const BRIDGE_BURN_EVENT_ENDPOINT = "/api/events/burn";

export const sendBridgeBurnEvent = (input: BridgeBurnEventInput): void => {
  if (typeof window === "undefined") return;

  const body = JSON.stringify(input);

  try {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.(BRIDGE_BURN_EVENT_ENDPOINT, blob)) {
      return;
    }
  } catch (error) {
    console.warn("[analytics] sendBeacon bridge burn event failed:", error);
  }

  try {
    fetch(BRIDGE_BURN_EVENT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch((error) => {
      console.warn("[analytics] bridge burn event request failed:", error);
    });
  } catch (error) {
    console.warn("[analytics] bridge burn event request failed:", error);
  }
};
