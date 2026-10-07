import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-accent-500 text-white shadow-sm hover:bg-accent-400',
        destructive: 'bg-danger-500 text-white shadow-sm hover:bg-danger-400',
        outline:
          'border border-surface-500/40 bg-transparent text-surface-600 hover:bg-surface-200 hover:text-surface-800',
        secondary: 'bg-surface-200 text-surface-700 hover:bg-surface-300',
        ghost: 'text-surface-600 hover:bg-surface-200/50 hover:text-surface-900',
        'ghost-danger':
          'text-surface-600 hover:bg-danger-500/10 hover:text-danger-500 hover:border-danger-500/20',
        link: 'text-accent-400 underline-offset-4 hover:underline hover:text-accent-300',
      },
      size: {
        default: 'h-10 px-4 py-2.5 text-[13px]',
        xs: 'h-7 gap-1 px-2 text-[11px] rounded-lg [&_svg:not([class*="size-"])]:size-3',
        sm: 'h-8 gap-1.5 px-3 text-[12px]',
        lg: 'h-12 px-6 py-3 text-sm',
        icon: 'size-9',
        'icon-sm': 'size-8 rounded-lg',
        'icon-xs': 'size-7 rounded-lg [&_svg:not([class*="size-"])]:size-3',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
