import React from 'react';

export interface CardProps {
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

export const Card: React.FC<CardProps> = ({ title, children, style, className = '' }) => {
  return (
    <div
      className={`ui-card ${className}`.trim()}
      style={{
        background: 'var(--surface-card, hsla(217, 33%, 17%, 0.75))',
        border: '1px solid var(--border-soft, rgba(255, 255, 255, 0.1))',
        borderRadius: '8px',
        padding: '20px',
        color: 'var(--text-primary, #f8fafc)',
        ...style
      }}
    >
      {title && <h4 className="ui-card__title" style={{ margin: '0 0 12px 0', fontSize: '1rem', color: 'var(--section-accent, #38bdf8)' }}>{title}</h4>}
      {children}
    </div>
  );
};
