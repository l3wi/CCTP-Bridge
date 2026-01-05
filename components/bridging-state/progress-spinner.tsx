import { Loader2 } from "lucide-react";
import { formatTime } from "@/lib/utils";
import type { ProgressSpinnerProps } from "./types";

export function ProgressSpinner({
  timeLeft,
  progress,
  estimatedTime,
}: ProgressSpinnerProps) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-20 h-20 mb-4">
        <div className="absolute inset-0 rounded-full border-4 border-slate-700"></div>
        <div
          className="absolute inset-0 rounded-full border-4 border-blue-500 transition-all duration-1000"
          style={{
            clipPath: `polygon(50% 50%, 50% 0%, ${
              progress > 75 ? "100% 0%" : "50% 0%"
            }, ${
              progress > 50
                ? "100% 100%"
                : progress > 25
                ? "100% 50%"
                : "50% 0%"
            }, ${progress > 25 ? "0% 100%" : "50% 50%"}, ${
              progress > 0 ? "0% 0%" : "50% 0%"
            }, 50% 0%)`,
            transform: "rotate(90deg)",
          }}
        ></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
        </div>
      </div>

      {estimatedTime ? (
        <div className="text-center mb-4">
          <div className="text-2xl font-bold mb-1">
            {timeLeft === 0 ? "Still waiting..." : formatTime(timeLeft)}
          </div>
          <div className="text-sm text-slate-400">
            {timeLeft === 0
              ? "Waiting for confirmation"
              : "Estimated time remaining"}
          </div>
        </div>
      ) : (
        <div className="text-center mb-4">
          <div className="text-2xl font-bold mb-1">Bridge in progress</div>
          <div className="text-sm text-slate-400">
            Circle will update steps automatically.
          </div>
        </div>
      )}
    </div>
  );
}
