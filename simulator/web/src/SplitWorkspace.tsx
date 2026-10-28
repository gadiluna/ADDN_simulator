import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';

const MIN_INSPECTOR = 320;
const MIN_NETWORK = 400;
const DRAWER_BREAKPOINT = 760;

// Keep resize updates here so dragging does not rebuild the graph's React children.
export default function SplitWorkspace({ open, children }: { open: boolean; children: ReactNode }) {
  const workspace = useRef<HTMLElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(() => window.innerWidth);
  const [preferredWidth, setPreferredWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const maximum = Math.max(MIN_INSPECTOR, workspaceWidth - MIN_NETWORK);
  const width = Math.min(maximum, Math.max(MIN_INSPECTOR, preferredWidth ?? (workspaceWidth <= 1000 ? 360 : 420)));

  const stopDragging = useCallback(() => {
    const pointer = drag.current?.pointer;
    drag.current = null;
    setDragging(false);
    if (pointer !== undefined && divider.current?.hasPointerCapture(pointer)) divider.current.releasePointerCapture(pointer);
  }, []);

  useEffect(() => {
    const element = workspace.current!;
    const measure = () => setWorkspaceWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('blur', stopDragging);
    return () => {
      observer.disconnect();
      window.removeEventListener('blur', stopDragging);
    };
  }, [stopDragging]);

  useEffect(() => {
    if (!open || workspaceWidth <= DRAWER_BREAKPOINT) stopDragging();
  }, [open, workspaceWidth, stopDragging]);

  const resize = (next: number) => {
    const available = workspace.current?.getBoundingClientRect().width ?? workspaceWidth;
    setPreferredWidth(Math.min(Math.max(MIN_INSPECTOR, available - MIN_NETWORK), Math.max(MIN_INSPECTOR, next)));
  };
  const startDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || workspaceWidth <= DRAWER_BREAKPOINT) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, width };
    setDragging(true);
  };
  const moveDivider = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    resize(active.width + active.x - event.clientX);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 64 : 32;
    switch (event.key) {
      case 'ArrowLeft': resize(width + step); break;
      case 'ArrowRight': resize(width - step); break;
      case 'Home': resize(MIN_INSPECTOR); break;
      case 'End': resize(maximum); break;
      case 'Enter': setPreferredWidth(null); break;
      case ' ': break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return <main ref={workspace} className={`workspace${open ? ' with-inspector' : ''}${dragging && open ? ' is-resizing' : ''}`} style={{ '--inspector-width': `${width}px` } as CSSProperties}>
    {children}
    {open && <div ref={divider} className="panel-divider" role="separator" tabIndex={0}
      aria-label="Resize network and agent panels" aria-orientation="vertical" aria-controls="agent-inspector"
      aria-valuemin={MIN_INSPECTOR} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(width)}
      aria-valuetext={`Agent panel ${Math.round(width)} pixels wide`} aria-describedby="panel-divider-help"
      title="Drag to resize · Double-click to reset"
      onPointerDown={startDragging} onPointerMove={moveDivider} onPointerUp={stopDragging}
      onPointerCancel={stopDragging} onLostPointerCapture={stopDragging} onKeyDown={keyDown}
      onDoubleClick={() => setPreferredWidth(null)}>
      <span id="panel-divider-help" className="sr-only">Drag or use Left and Right arrows to resize. Double-click or press Enter to reset.</span>
    </div>}
  </main>;
}
