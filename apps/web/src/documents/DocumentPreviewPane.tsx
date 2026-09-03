import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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

/** Shared controls sit above this spread. Native zoom keeps both pages at the same layout scale. */
export function DocumentReviewPages({ children, previewContent, width }: { children: ReactNode; previewContent?: ReactNode; width: number }) {
  const spreadRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState('fit');
  useLayoutEffect(() => {
    const spread = spreadRef.current;
    if (!spread || !previewContent) return;
    const measure = () => {
      const pane = spread.querySelector('.document-review-pages__side');
      if (pane) setFit(Math.min(1, Math.max(0.15, (pane.clientWidth - 40) / width)));
    };
    const observer = new ResizeObserver(measure); observer.observe(spread); measure();
    return () => observer.disconnect();
  }, [Boolean(previewContent), width]);
  if (!previewContent) return children;
  const scale = zoom === 'fit' ? fit : Number(zoom);
  return <div className="document-review-pages" ref={spreadRef} style={{ '--review-scale': scale, '--review-paper-width': `${width}px`, '--review-paper-height': `${width === 794 ? 1123 : 794}px` } as CSSProperties}>
    <div className="document-review-pages__heading"><strong>편집</strong><label>양쪽 배율 <select aria-label="편집 및 미리보기 배율" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit">나란히 맞춤 ({Math.round(fit * 100)}%)</option><option value="1">100%</option><option value="0.75">75%</option></select></label><strong>출력 미리보기</strong></div>
    <div className="document-review-pages__spread">
      <div className="document-review-pages__side">{children}</div>
      <div className="document-review-pages__side document-review-pages__output" aria-label="출력 미리보기"><div className="document-review-pages__paper">{previewContent}</div></div>
    </div>
  </div>;
}
