"use client";

import { LazyMotion, MotionConfig, useReducedMotion } from "motion/react";
import { createContext, useContext, useState, type ReactNode } from "react";

// D51: motion/react animates in JS, so the CSS motion tokens of D40
// (globals.css) do not reach it. These are their values in seconds, and with
// prefers-reduced-motion every duration is 0, as in D40. A unit test keeps them
// equal to globals.css.
export const MOTION_SECONDS = { fast: 0.12, base: 0.15, slow: 0.3 } as const;
export const EASE_STANDARD = [0.2, 0, 0, 1] as const;

const MotionOnContext = createContext(false);

/**
 * D51: true when an `m.*` element may have a start or exit state: the
 * animation features have loaded and prefers-reduced-motion is off. Until they
 * load, if their chunk fails, or with reduce, components leave those states
 * out, so an animation that cannot run never leaves anything hidden.
 */
export function useMotionOn(): boolean {
  return useContext(MotionOnContext);
}

/** Motion for the protected pages: one provider, under the protected layout only. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const [loaded, setLoaded] = useState(false);

  // D51: the animation features load with import() after hydration, outside the
  // initial JS. `strict` makes a `motion.*` component (which would bundle them
  // into the initial JS) throw, so components use `m.*` from "motion/react-m".
  // LazyMotion registers the features in its own .then on this promise, queued
  // after the one here, so they are in place before React renders with
  // `loaded`. If the chunk fails, `loaded` stays false; LazyMotion's chain,
  // which has no catch, reports the rejection in the console.
  const loadFeatures = () => {
    const features = import("./motion-features").then((mod) => mod.default);
    features.then(
      () => setLoaded(true),
      () => undefined,
    );
    return features;
  };

  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig
        reducedMotion="user"
        transition={reduce ? { duration: 0 } : { duration: MOTION_SECONDS.base, ease: EASE_STANDARD }}
      >
        {/* One element, not `children` directly: motion's types resolve the root @types/react (18, from apps/mobile), whose ReactNode lacks bigint. */}
        <MotionOnContext.Provider value={loaded && reduce !== true}>{children}</MotionOnContext.Provider>
      </MotionConfig>
    </LazyMotion>
  );
}
