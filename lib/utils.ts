import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

/**
 * Infer the CCTP contract version from a raw message payload.
 * V1 burn messages stop after the messageSender field (~132 bytes).
 * V2 messages append maxFee, feeExecuted, expirationBlock, etc.,
 * making the message body strictly longer.
 */
export const inferCctpVersionFromMessage = (
  message?: `0x${string}` | null
): "v1" | "v2" | null => {
  if (!message || message === "0x") {
    return null;
  }

  try {
    const MESSAGE_HEADER_BYTES = 148;
    const V1_BODY_BYTES = 132;

    const totalBytes = (message.length - 2) / 2;
    if (totalBytes <= MESSAGE_HEADER_BYTES) {
      return null;
    }

    const bodyBytes = totalBytes - MESSAGE_HEADER_BYTES;

    if (bodyBytes > V1_BODY_BYTES) {
      return "v2";
    }

    return "v1";
  } catch (error) {
    console.warn("Unable to infer CCTP version from message:", error);
    return null;
  }
};
