import type { ReactNode } from "react";

/**
 * A horizontally snap-scrolling strip. Children should set their own min-width
 * and `snap-start`. Works on every device (trackpad / touch / drag), scrollbar
 * hidden. Bleeds to the screen edges for a momentum feel.
 */
export function HorizontalStrip({ children }: { children: ReactNode }) {
  return (
    <div className="no-scrollbar -mx-6 flex snap-x snap-mandatory gap-5 overflow-x-auto px-6 pb-3">
      {children}
    </div>
  );
}
