import { useEffect, useRef, useState } from 'react';

export type AiGenerationStatus = 'running' | 'complete' | 'error';

interface AiGenerationProgressModalProps {
  isOpen: boolean;
  status: AiGenerationStatus;
  title: string;
  description: string;
  stages: readonly string[];
  completeMessage: string;
  errorMessage?: string;
  providerLabel?: string;
  confirmLabel?: string;
  timeoutHintSeconds?: number;
  retryLabel?: string;
  onRetry?: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function AiGenerationProgressModal({
  isOpen,
  status,
  title,
  description,
  stages,
  completeMessage,
  errorMessage,
  providerLabel = 'AI',
  confirmLabel = '확인하고 다음 단계로',
  timeoutHintSeconds = 220,
  retryLabel = '다시 시도',
  onRetry,
  onConfirm,
  onClose
}: AiGenerationProgressModalProps): React.ReactElement | null {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const actionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (status === 'complete') {
      window.setTimeout(() => actionRef.current?.focus(), 40);
      return;
    }
    if (status === 'error') {
      window.setTimeout(() => actionRef.current?.focus(), 40);
      return;
    }
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isOpen, status, title]);

  useEffect(() => {
    if (!isOpen || status === 'running') return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onClose, status]);

  if (!isOpen) return null;
  const statusLabel = status === 'running' ? '작성 중' : status === 'complete' ? '작성 완료' : '확인 필요';

  return <div className="ai-generation-overlay" role="presentation">
    <section className={`ai-generation-modal is-${status}`} role="dialog" aria-modal="true" aria-labelledby="ai-generation-title" aria-describedby="ai-generation-description">
      <div className="ai-generation-modal__signal" aria-hidden="true">
        {status === 'complete' ? <span>✓</span> : status === 'error' ? <span>!</span> : <i />}
      </div>
      <span className="ai-generation-modal__eyebrow">{providerLabel.toUpperCase()} · CLAIM CENTER STUDIO</span>
      <h2 id="ai-generation-title">{title}</h2>
      <p id="ai-generation-description">{status === 'complete' ? completeMessage : status === 'error' ? errorMessage ?? 'AI 작성 결과를 저장하지 못했습니다.' : description}</p>
      <div className="ai-generation-modal__meter" role="progressbar" aria-label={statusLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={status === 'complete' ? 100 : status === 'error' ? 0 : undefined} aria-valuetext={status === 'running' ? `AI 공급자 응답 대기 · ${elapsedSeconds}초 경과` : statusLabel}>
        <span><i /></span>
        <strong>{status === 'error' ? '처리 중단' : status === 'complete' ? '완료' : `응답 대기 · ${elapsedSeconds}초`}</strong>
      </div>
      <ol className="ai-generation-modal__stages" aria-label="AI 작성 처리 단계">
        {stages.map((stage, index) => <li key={stage} className={status === 'complete' ? 'is-complete' : status === 'running' && index === 0 ? 'is-current' : ''}>
          <b>{status === 'complete' ? '✓' : index + 1}</b><span>{stage}</span>
        </li>)}
      </ol>
      <div className="ai-generation-modal__actions">
        {status === 'complete' && <button ref={actionRef} type="button" className="ai-generation-modal__confirm" onClick={onConfirm}>✓ {confirmLabel}</button>}
        {status === 'error' && <>
          {onRetry && <button ref={actionRef} type="button" className="ai-generation-modal__retry" onClick={onRetry}>{retryLabel}</button>}
          <button ref={onRetry ? undefined : actionRef} type="button" className="ai-generation-modal__close" onClick={onClose}>닫고 입력 확인</button>
        </>}
        {status === 'running' && <small>{elapsedSeconds >= 30 ? `${providerLabel} 응답을 기다리고 있습니다. ${timeoutHintSeconds}초 제한에 도달하면 정확한 실패 원인과 재시도 방법을 표시합니다.` : '아직 완료된 단계는 없습니다. 서버가 실제 결과를 받은 뒤에만 완료로 표시합니다.'}</small>}
      </div>
    </section>
  </div>;
}
