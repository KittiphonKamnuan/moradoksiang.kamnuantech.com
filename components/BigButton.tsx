import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const styles: Record<Variant, string> = {
  primary: 'bg-amber text-ink shadow-[0_6px_0_var(--color-amber-d)] active:translate-y-[3px] active:shadow-[0_3px_0_var(--color-amber-d)]',
  secondary: 'bg-white text-ink border-2 border-line',
  ghost: 'bg-transparent text-ink-soft underline underline-offset-4',
};

export function BigButton({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-[72px] w-full rounded-2xl px-6 font-display text-2xl transition disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  );
}
