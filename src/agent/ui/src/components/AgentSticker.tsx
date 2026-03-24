import { type FC, useEffect, useRef } from "react";
import { cn } from "../utils";

interface AgentStickerProps {
  size?: number;
  playOnMount?: boolean;
  bare?: boolean;
  className?: string;
}

const STICKER_DURATION_MS = 3000;

export const AgentSticker: FC<AgentStickerProps> = ({
  size = 28,
  playOnMount = false,
  bare = false,
  className,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resetToStart = () => {
      try {
        video.pause();
        video.currentTime = 0;
      } catch {
        // Best effort only; some browsers may reject currentTime before metadata.
      }
    };

    const playSticker = async () => {
      resetToStart();
      if (!playOnMount || prefersReducedMotion) return;

      try {
        await video.play();
        timeoutId = setTimeout(() => {
          try {
            video.pause();
          } catch {
            // no-op
          }
        }, STICKER_DURATION_MS);
      } catch {
        resetToStart();
      }
    };

    const handleLoadedMetadata = () => {
      void playSticker();
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    if (video.readyState >= 1) {
      void playSticker();
    } else {
      video.load();
    }

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      if (timeoutId) clearTimeout(timeoutId);
      try {
        video.pause();
      } catch {
        // no-op
      }
    };
  }, [playOnMount]);

  return (
    <div
      className={cn(
        bare
          ? "overflow-hidden bg-transparent shadow-none"
          : "overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_10px_24px_rgba(0,0,0,0.22)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <video
        ref={videoRef}
        aria-label="Echo sticker"
        className={cn(
          "h-full w-full",
          bare
            ? "object-contain"
            : "object-cover",
        )}
        muted
        playsInline
        preload="metadata"
        src="/sticker.webm"
      />
    </div>
  );
};
