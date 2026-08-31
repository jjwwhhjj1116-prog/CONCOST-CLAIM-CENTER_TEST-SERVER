import React from 'react';

export type StatusType = 'approved' | 'completed' | 'ai_draft' | 'review' | 'request_changes' | 'unwritten' | 'draft' | 'in_review' | 'rejected';

export interface StatusBadgeProps {
  status: StatusType;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    approved: { label: '🟢 승인됨', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.15)' },
    completed: { label: '🟢 등록 완료', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.14)' },
    ai_draft: { label: '🟣 AI초안', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.15)' },
    review: { label: '🔵 검토중', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' },
    in_review: { label: '🔵 검토중', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' },
    draft: { label: '⚪ 초안', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' },
    rejected: { label: '🔴 반려됨', color: '#f87171', bg: 'rgba(248, 113, 113, 0.15)' },
    request_changes: { label: '🟠 수정요청', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' },
    unwritten: { label: '⚪ 미작성', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' }
  };

  const key = status.toLowerCase();
  const current = config[key] || { label: `⚪ ${status}`, color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' };

  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '.75rem',
        fontWeight: 600,
        color: current.color,
        background: current.bg,
        border: `1px solid ${current.color}40`,
        display: 'inline-block'
      }}
    >
      {current.label}
    </span>
  );
};
