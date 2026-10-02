import * as React from 'react';

/** Keep overlays inside the visible area when the mobile keyboard opens. */
export function OverlayViewport({
  children,
}: {
  children: React.ReactElement<{
    style?: React.CSSProperties;
    onCloseAutoFocus?: (event: Event) => void;
  }>;
}) {
  // This wrapper mounts with the portal, before its fields receive focus.
  // Programmatically opened dialogs may not have a Radix Trigger to return to.
  const [returnFocus] = React.useState(() => document.activeElement);
  const readViewport = React.useCallback(() => {
    const viewport = window.visualViewport;
    return {
      '--overlay-height': `${viewport?.height ?? window.innerHeight}px`,
      '--overlay-top': `${viewport?.offsetTop ?? 0}px`,
    } as React.CSSProperties;
  }, []);
  const [viewportStyle, setViewportStyle] = React.useState(readViewport);

  React.useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setViewportStyle(readViewport()));
    };
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    setViewportStyle(readViewport());
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [readViewport]);

  return React.cloneElement(children, {
    style: { ...viewportStyle, ...children.props.style },
    onCloseAutoFocus: (event) => {
      children.props.onCloseAutoFocus?.(event);
      if (
        !event.defaultPrevented &&
        returnFocus instanceof HTMLElement &&
        returnFocus.isConnected
      ) {
        event.preventDefault();
        returnFocus.focus({ preventScroll: true });
      }
    },
  });
}
