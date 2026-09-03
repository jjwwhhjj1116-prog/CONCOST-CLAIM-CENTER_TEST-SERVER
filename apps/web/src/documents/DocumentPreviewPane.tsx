import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './DocumentReviewWorkspace.css';

/** Only the read-only display is scaled; document metrics and editor hit testing stay unchanged. */
export function DocumentPreviewPane({ children, title = '출력 미리보기', width = 794 }: { children: ReactNode; title?: string; width?: number }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: 1, height: 1123 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const paper = paperRef.current;
    if (!viewport || !paper) return;
    const measure = () => {
      const next = { scale: Math.min(1, Math.max(0.15, (viewport.clientWidth - 24) / width)), height: paper.scrollHeight };
      setSize(current => current.scale === next.scale && current.height === next.height ? current : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport); observer.observe(paper); measure();
    return () => observer.disconnect();
  }, [width]);
  return <aside className="document-preview-pane" aria-label={title}>
    <header><strong>{title}</strong><span>머리글·꼬리말 포함 · 화면 맞춤 {Math.round(size.scale * 100)}%</span></header>
    <div className="document-preview-pane__viewport" ref={viewportRef}>
      <div className="document-preview-pane__frame" style={{ width: width * size.scale, height: size.height * size.scale }}>
        <div className="document-preview-pane__paper" ref={paperRef} style={{ width, transform: `scale(${size.scale})` }}>{children}</div>
      </div>
    </div>
  </aside>;
}
