import React from 'react';

// The game's buttons: one look per role, so a primary action always reads the same way

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent-amber text-[#0d0f13] shadow-[0_0_22px_rgba(255,184,0,0.35),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-110 '
    + 'disabled:bg-white/[0.06] disabled:text-white/40 disabled:shadow-none',
  secondary: 'bg-white/[0.05] text-white/85 border border-white/[0.12] hover:bg-white/[0.1] hover:border-white/25 hover:text-white '
    + 'disabled:text-white/35 disabled:border-white/[0.06]',
  danger: 'bg-accent-red text-[#0d0f13] shadow-[0_0_22px_rgba(255,77,77,0.3)] hover:brightness-110 '
    + 'disabled:bg-white/[0.06] disabled:text-white/40 disabled:shadow-none',
  ghost: 'text-white/65 hover:text-white hover:bg-white/[0.06] disabled:text-white/30',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-[12px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-[13px] gap-2 rounded-lg',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-xl',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center font-display font-semibold uppercase tracking-[0.08em] whitespace-nowrap select-none
        transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1117]
        ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    />
  ),
);
Button.displayName = 'Button';
