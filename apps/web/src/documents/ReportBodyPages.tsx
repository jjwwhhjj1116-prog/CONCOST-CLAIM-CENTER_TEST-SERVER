import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { paginateReport } from './report-pagination';

export function ReportBodyPages({ html, header }: { html: string; header: ReactNode }): React.ReactElement {
  const sourceRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState({ pages: [''], overflow: false, ready: false });
  useLayoutEffect(() => {
    const source = sourceRef.current?.querySelector<HTMLElement>('.structured-editor__preview');
    if (!source) return;
    let active = true, frame = 0;
    const paginate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = paginateReport(source, source.clientHeight);
        if (active) setLayout({ ...next, ready: true });
      });
    };
    const images = [...source.querySelectorAll('img')];
    images.forEach(image => { image.addEventListener('load', paginate); image.addEventListener('error', paginate); });
    window.addEventListener('resize', paginate); window.addEventListener('final-document:refit', paginate);
    void document.fonts?.ready.then(paginate); paginate();
    return () => { active = false; cancelAnimationFrame(frame); window.removeEventListener('resize', paginate); window.removeEventListener('final-document:refit', paginate); images.forEach(image => { image.removeEventListener('load', paginate); image.removeEventListener('error', paginate); }); };
  }, [html, header]);
  return <>
    <section ref={sourceRef} className="report-final-body report-pagination-source" aria-hidden="true">{header}<article className="structured-editor__preview" dangerouslySetInnerHTML={{ __html: html }}/></section>
    {layout.overflow && <p className="error-box" role="alert">한 페이지보다 큰 표 행·이미지 또는 머리글이 있습니다. 크기를 줄여 주세요. 내용은 보존되며, 잘린 상태로 출력하지 않습니다.</p>}
    {layout.pages.map((page, index) => <section className="report-final-body report-paginated-sheet" key={index} data-export-page data-export-page-policy="fit" data-page-fit-overflow={!layout.ready || layout.overflow} data-page-number={index + 2}>
      {header}<article className="structured-editor__preview" dangerouslySetInnerHTML={{ __html: page }}/>
      <span className="report-page-label" data-html2canvas-ignore="true">본문 {index + 1} / {layout.pages.length} · A4</span>
    </section>)}
  </>;
}
