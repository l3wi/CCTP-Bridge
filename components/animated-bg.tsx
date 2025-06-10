"use client";

import type React from "react";
import { useState, useCallback } from "react";

interface TelegramLogoProps {
  className?: string;
  size?: number;
}

export function TelegramLogo({ className, size = 12 }: TelegramLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
    >
      <path d="M18.384,22.779c0.322,0.228 0.737,0.285 1.107,0.145c0.37,-0.141 0.642,-0.457 0.724,-0.84c0.869,-4.084 2.977,-14.421 3.768,-18.136c0.06,-0.28 -0.04,-0.571 -0.26,-0.758c-0.22,-0.187 -0.525,-0.241 -0.797,-0.14c-4.193,1.552 -17.106,6.397 -22.384,8.35c-0.335,0.124 -0.553,0.446 -0.542,0.799c0.012,0.354 0.25,0.661 0.593,0.764c2.367,0.708 5.474,1.693 5.474,1.693c0,0 1.452,4.385 2.209,6.615c0.095,0.28 0.314,0.5 0.603,0.576c0.288,0.075 0.596,-0.004 0.811,-0.207c1.216,-1.148 3.096,-2.923 3.096,-2.923c0,0 3.572,2.619 5.598,4.062Zm-11.01,-8.677l1.679,5.538l0.373,-3.507c0,0 6.487,-5.851 10.185,-9.186c0.108,-0.098 0.123,-0.262 0.033,-0.377c-0.089,-0.115 -0.253,-0.142 -0.376,-0.064c-4.286,2.737 -11.894,7.596 -11.894,7.596Z" />
    </svg>
  );
}

interface XLogoProps {
  className?: string;
  size?: number;
}

export function XLogo({ className, size = 12 }: XLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 300 300.251"
      className={className}
      fill="currentColor"
    >
      <path d="M178.57 127.15 290.27 0h-26.46l-97.03 110.38L89.34 0H0l117.13 166.93L0 300.25h26.46l102.4-116.59 81.8 116.59h89.34M36.01 19.54H76.66l187.13 262.13h-40.66" />
    </svg>
  );
}

interface AnimatedBackgroundProps {
  children?: React.ReactNode;
}

interface PlusSymbol {
  id: number;
  x: number;
  y: number;
  opacity: number;
}

export default function AnimatedBackground({
  children,
}: AnimatedBackgroundProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Perspective Grid */}
      <div className="absolute inset-0 opacity-25">
        <div
          className="absolute inset-0 animate-grid-shift"
          style={{
            backgroundImage: `
              linear-gradient(rgba(148, 163, 184, 0.15) 1px, transparent 1px),
              linear-gradient(90deg, rgba(148, 163, 184, 0.15) 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px",
            transform: "perspective(500px) rotateX(60deg)",
            transformOrigin: "center bottom",
          }}
        />
      </div>

      {/* Shifting Gradient Overlay */}
      <div className="absolute inset-0 opacity-30 overflow-hidden">
        <div
          className="absolute animate-gradient-float"
          style={{
            width: "200%",
            height: "200%",
            left: "-50%",
            top: "-50%",
            background: `
              radial-gradient(
                ellipse 800px 400px at 50% 50%,
                rgba(59, 130, 246, 0.15) 0%,
                rgba(147, 51, 234, 0.1) 25%,
                transparent 50%
              )
            `,
          }}
        />
      </div>

      {/* Your content goes here */}
      {children}

      {/* Footer */}
      <div className="absolute bottom-4 right-4 z-20">
        <div className="flex items-center gap-3 text-xs text-slate-400/70 font-medium">
          <span>made by lewi</span>
          <a
            href="https://x.com/lewifree"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-300 transition-colors duration-200 flex items-center"
            aria-label="X (Twitter)"
          >
            <XLogo size={12} />
          </a>
          <a
            href="https://t.me/twpks"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-300 transition-colors duration-200 flex items-center"
            aria-label="Telegram"
          >
            <TelegramLogo size={14} />
          </a>
        </div>
      </div>

      <style jsx>{`
        @keyframes grid-shift {
          0%,
          100% {
            transform: perspective(500px) rotateX(60deg) translateY(0px);
          }
          50% {
            transform: perspective(500px) rotateX(60deg) translateY(-20px);
          }
        }

        @keyframes gradient-float {
          0% {
            transform: translate(0%, 0%);
          }
          25% {
            transform: translate(15%, 10%);
          }
          50% {
            transform: translate(5%, 25%);
          }
          75% {
            transform: translate(-10%, 15%);
          }
          100% {
            transform: translate(0%, 0%);
          }
        }

        @keyframes float {
          0%,
          100% {
            transform: translateY(0px) translateX(0px);
            opacity: 0.1;
          }
          25% {
            opacity: 0.3;
          }
          50% {
            transform: translateY(-20px) translateX(10px);
            opacity: 0.1;
          }
          75% {
            opacity: 0.2;
          }
        }

        .animate-grid-shift {
          animation: grid-shift 20s ease-in-out infinite;
        }

        .animate-float {
          animation: float linear infinite;
        }

        @keyframes fade-out {
          0% {
            opacity: 0.3;
            transform: translate(-50%, -50%) scale(0.8);
          }
          20% {
            opacity: 0.2;
            transform: translate(-50%, -50%) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(1.2);
          }
        }

        .animate-fade-out {
          animation: fade-out 2s ease-out forwards;
        }

        .animate-gradient-float {
          animation: gradient-float 25s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
