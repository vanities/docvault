import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full min-w-0 rounded-xl border border-border bg-surface-100 px-3 py-2.5 text-sm text-surface-950 shadow-xs transition-all outline-none placeholder:text-surface-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-accent-400 focus-visible:ring-2 focus-visible:ring-accent-400/30',
        className
      )}
      {...props}
    />
  );
}

export { Input };
