import { useState } from 'react';

/**
 * Cap a list to the first `n` items with an expand toggle. Pair with the
 * <ShowMore> control (src/components/ui/ShowMore.tsx). Call at the top level of
 * a component (it's a hook).
 */
export function useTopN<T>(items: T[], n = 10) {
  const [expanded, setExpanded] = useState(false);
  return {
    visible: expanded ? items : items.slice(0, n),
    expanded,
    hiddenCount: Math.max(0, items.length - n),
    toggle: () => setExpanded((e) => !e),
  };
}
