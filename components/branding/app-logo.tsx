import React from "react";
import { cn } from "@/lib/utils";

interface AppLogoProps {
  className?: string;
  alt?: string;
}

/**
 * Renders the official CBT SMART EXAM emblem from static `/icons/logo.png`
 * so PWA static caching and hot portals load quickly without extra image-proxy overhead.
 */
export function AppLogo({
  className,
  alt = "Logo CBT SMART EXAM",
}: AppLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/logo.png"
      alt={alt}
      width={560}
      height={395}
      draggable={false}
      className={cn("h-12 w-auto select-none object-contain", className)}
    />
  );
}
