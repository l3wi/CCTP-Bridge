export const TransferSpeed = {
  FAST: "fast",
  SLOW: "standard",
} as const;

export type TransferSpeedValue =
  (typeof TransferSpeed)[keyof typeof TransferSpeed];
