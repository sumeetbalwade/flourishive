import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn.ts';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium transition-colors duration-[var(--dur-fast)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:bg-accent-hi',
        secondary: 'border border-line-strong bg-transparent text-fg hover:bg-surface-2',
        ghost: 'bg-transparent text-muted hover:bg-surface-2 hover:text-fg',
        danger: 'bg-danger-lo text-danger hover:bg-danger hover:text-on-accent',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-5 text-sm',
        lg: 'h-12 px-7 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
