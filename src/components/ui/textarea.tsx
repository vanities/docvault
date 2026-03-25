import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-xl border border-border bg-surface-100 px-3 py-2.5 text-sm text-surface-950 shadow-xs transition-all outline-none placeholder:text-surface-500 focus-visible:border-accent-400 focus-visible:ring-2 focus-visible:ring-accent-400/30 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
