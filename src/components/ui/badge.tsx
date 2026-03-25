import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-accent-500/15 text-accent-400',
        secondary: 'bg-surface-400/15 text-surface-800',
        destructive: 'bg-danger-500/15 text-danger-400',
        outline: 'border-border text-surface-800',
        income: 'bg-emerald-500/15 text-emerald-400',
        expense: 'bg-red-500/15 text-red-400',
        crypto: 'bg-purple-500/15 text-purple-400',
        info: 'bg-blue-500/15 text-blue-400',
        warning: 'bg-amber-500/15 text-amber-400',
        teal: 'bg-teal-500/15 text-teal-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
