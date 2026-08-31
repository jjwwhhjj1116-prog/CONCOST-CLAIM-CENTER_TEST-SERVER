import React from 'react';

export interface TimelineItem {
  id: string;
  title: string;
  timestamp: string;
  description?: string;
}

export interface TimelineProps {
  items: TimelineItem[];
}

export const Timeline: React.FC<TimelineProps> = ({ items }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderLeft: '2px solid var(--border-soft, rgba(255,255,255,0.1))', paddingLeft: '16px' }}>
      {items.map((item) => (
        <div key={item.id} style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: '-21px', top: '4px', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--section-accent, hsl(217, 91%, 60%))' }} />
          <div style={{ fontSize: '.75rem', color: 'var(--text-secondary, #94a3b8)' }}>{item.timestamp}</div>
          <div style={{ fontWeight: 'bold', color: 'var(--text-primary, #f8fafc)' }}>{item.title}</div>
          {item.description && <div style={{ fontSize: '.875rem', color: 'var(--text-muted, #cbd5e1)', marginTop: '4px' }}>{item.description}</div>}
        </div>
      ))}
    </div>
  );
};
