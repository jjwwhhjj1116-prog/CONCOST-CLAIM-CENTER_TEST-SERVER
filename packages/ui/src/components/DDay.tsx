import React from 'react';

export interface DDayProps {
  targetDate: string;
  daysRemaining: number;
}

export const DDay: React.FC<DDayProps> = ({ targetDate, daysRemaining }) => {
  const isUrgent = daysRemaining <= 3;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontWeight: 'bold',
        color: isUrgent ? 'hsl(346, 87%, 60%)' : '#38bdf8'
      }}
    >
      <span>📅 D-{daysRemaining}</span>
      <span style={{ fontSize: '.75rem', color: '#94a3b8', fontWeight: 'normal' }}>({targetDate})</span>
    </span>
  );
};
