import React, { useEffect, useRef, useState } from 'react';

const DRAFT_KEY_STORAGE = 'claim-center-preview-draft-key';

type DraftStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'error';

interface PreviewDraftPayload {
  draft?: {
    title?: string;
    content?: string;
    updatedAt?: string | null;
  };
  code?: string;
}

export function previewBrowserKey(): string {
  const current = window.localStorage.getItem(DRAFT_KEY_STORAGE);
  if (current) return current;
  const created = window.crypto.randomUUID();
  window.localStorage.setItem(DRAFT_KEY_STORAGE, created);
  return created;
}

const statusCopy: Record<DraftStatus, string> = {
  loading: '클라우드 초안을 불러오는 중',
  ready: '입력 대기',
  saving: '자동 저장 중',
  saved: '클라우드 저장 완료',
  error: '클라우드 연결 대기 중'
};

export const PreviewCloudDraft: React.FC = () => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<DraftStatus>('loading');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const draftKeyRef = useRef('');
  const hydratedRef = useRef(false);
  const saveSequenceRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setStatus('loading');
      try {
        draftKeyRef.current = previewBrowserKey();
        const response = await fetch('/api/preview/draft', {
          headers: { 'X-Preview-Draft-Key': draftKeyRef.current },
          signal: controller.signal
        });
        const payload = await response.json() as PreviewDraftPayload;
        if (!response.ok) throw new Error(payload.code ?? 'DRAFT_LOAD_FAILED');
        setTitle(payload.draft?.title ?? '새 클레임 검토 보고서');
        setContent(payload.draft?.content ?? '핵심 쟁점과 근거 자료를 여기에 정리하세요. 입력 내용은 자동 저장됩니다.');
        setUpdatedAt(payload.draft?.updatedAt ?? null);
        hydratedRef.current = true;
        setStatus('ready');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setStatus('error');
      }
    };
    void load();
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!hydratedRef.current || !draftKeyRef.current) return;
    const sequence = ++saveSequenceRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus('saving');
      try {
        const response = await fetch('/api/preview/draft', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Preview-Draft-Key': draftKeyRef.current
          },
          body: JSON.stringify({ title, content }),
          signal: controller.signal
        });
        const payload = await response.json() as PreviewDraftPayload;
        if (!response.ok) throw new Error(payload.code ?? 'DRAFT_SAVE_FAILED');
        if (sequence !== saveSequenceRef.current) return;
        setUpdatedAt(payload.draft?.updatedAt ?? new Date().toISOString());
        setStatus('saved');
      } catch (error) {
        if ((error as Error).name !== 'AbortError' && sequence === saveSequenceRef.current) setStatus('error');
      }
    }, 800);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [title, content]);

  const timestamp = updatedAt
    ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(updatedAt))
    : '첫 저장 전';

  return (
    <section className="preview-cloud-draft" aria-labelledby="preview-cloud-draft-title">
      <header>
        <div>
          <span className="workspace-eyebrow">WORKSPACE · AUTO SAVE</span>
          <h3 id="preview-cloud-draft-title">Cloud Draft</h3>
          <p>브라우저를 닫아도 이 기기의 초안을 다시 불러옵니다.</p>
        </div>
        <div className={`preview-draft-status preview-draft-status--${status}`} role="status" aria-live="polite">
          <span aria-hidden="true" />
          <strong>{statusCopy[status]}</strong>
          <small>{timestamp}</small>
        </div>
      </header>

      <label>
        <span>REPORT TITLE</span>
        <input value={title} maxLength={200} disabled={status === 'loading'} onChange={(event) => setTitle(event.target.value)} placeholder="보고서 제목" />
      </label>
      <label>
        <span>WORKING NOTE</span>
        <textarea value={content} maxLength={65_536} disabled={status === 'loading'} onChange={(event) => setContent(event.target.value)} placeholder="핵심 쟁점, 근거, 작성 메모를 입력하세요." />
      </label>
      <footer>
        <span>이 미리보기는 브라우저별 임시 초안 1개를 암호학적 식별자로 분리합니다.</span>
        {status === 'error' ? <button type="button" onClick={() => setRetry((value) => value + 1)}>연결 다시 시도</button> : null}
      </footer>
    </section>
  );
};
