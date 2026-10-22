import React from 'react';

// A key cap. `tone="dark"` sits on light (amber) buttons, the default on dark panels.
export const Kbd: React.FC<{ children: React.ReactNode; tone?: 'light' | 'dark'; className?: string }> =
  ({ children, tone = 'light', className = '' }) => (
    <kbd
      className={`inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded border font-mono text-[10px] font-bold leading-none ${
        tone === 'dark' ? 'border-black/25 bg-black/10 text-black/70' : 'border-white/15 bg-white/[0.06] text-white/75'
      } ${className}`}
    >
      {children}
    </kbd>
  );
