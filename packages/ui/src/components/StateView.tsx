import React from 'react';

export type UIState = 'normal' | 'loading' | 'empty' | 'error' | 'forbidden';

export interface StateViewProps {
  state: UIState;
  onRetry?: () => void;
  children: React.ReactNode;
}

export const StateView: React.FC<StateViewProps> = ({ state, onRetry, children }) => {
  if (state === 'normal') return <>{children}</>;

  if (state === 'loading') {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }} aria-live="polite" aria-label="데이터 로딩 중">
        <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>⌛</div>
        <div>데이터를 불러오는 중입니다...</div>
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }} aria-label="빈 상태">
        <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>📂</div>
        <div>표시할 데이터가 존재하지 않습니다.</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={{ padding: '24px', background: 'hsl(346, 87%, 60%)', color: '#ffffff', borderRadius: '8px', textAlign: 'center' }} aria-label="오류 상태">
        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>⚠️ 시스템 오류가 발생했습니다.</div>
        {onRetry && (
          <button onClick={onRetry} style={{ background: '#ffffff', color: 'hsl(346, 87%, 60%)', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            다시 시도
          </button>
        )}
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div style={{ padding: '32px', background: 'rgba(15, 23, 42, 0.95)', border: '1px solid hsl(346, 87%, 60%)', borderRadius: '8px', textAlign: 'center', color: '#f8fafc' }} aria-label="403 권한 없음">
        <h3 style={{ color: 'hsl(346, 87%, 60%)', margin: '0 0 12px 0' }}>🔒 접근 권한이 없습니다 (HTTP 403 Forbidden)</h3>
        <p style={{ fontSize: '.875rem', color: '#94a3b8', margin: 0 }}>이 라우트 또는 기능에 접근할 수 있는 사용자 권한이 부여되지 않았습니다.</p>
      </div>
    );
  }

  return null;
};
