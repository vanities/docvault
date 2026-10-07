import * as React from 'react';
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { OverlayViewport } from './overlay-viewport';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  fullscreen = false,
  closeDisabled = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  fullscreen?: boolean;
  closeDisabled?: boolean;
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <OverlayViewport>
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            'fixed z-50 flex flex-col overflow-y-auto overscroll-contain shadow-2xl outline-none transition-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 max-sm:[&_input]:text-base max-sm:[&_textarea]:text-base max-sm:[&_select]:text-base max-sm:[&_select]:min-h-11 max-sm:[&_[data-slot=select-trigger]]:min-h-11 max-sm:[&_[data-slot=select-trigger]]:text-base max-sm:[&_input:not([type=checkbox]):not([type=radio]):not([type=file])]:min-h-11',
            fullscreen
              ? 'inset-x-0 top-[var(--overlay-top,0px)] h-[var(--overlay-height,100dvh)] max-h-[var(--overlay-height,100dvh)] bg-background'
              : 'top-[calc(var(--overlay-top,0px)+var(--overlay-height,100dvh)-0.5rem)] left-1/2 w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] max-h-[calc(var(--overlay-height,100dvh)-1rem)] -translate-x-1/2 -translate-y-full gap-4 rounded-2xl glass-strong p-4 pb-[max(1rem,env(safe-area-inset-bottom))] duration-200 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:top-[calc(var(--overlay-top,0px)+var(--overlay-height,100dvh)/2)] sm:w-full sm:max-w-md sm:max-h-[calc(var(--overlay-height,100dvh)-2rem)] sm:-translate-y-1/2 sm:p-6',
            className
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              disabled={closeDisabled}
              className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-xl text-surface-500 hover:text-surface-900 hover:bg-surface-200/50 transition-colors focus:ring-2 focus:ring-ring focus:outline-hidden disabled:opacity-50 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </OverlayViewport>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        'min-h-0 min-w-0 max-h-[calc(var(--overlay-height,100dvh)*0.4)] shrink-0 flex flex-col gap-1.5 overflow-y-auto overscroll-contain pr-8',
        className
      )}
      {...props}
    />
  );
}

/** Scroll the form while its title and actions stay visible. */
function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        'min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain -mx-1 px-1 py-0.5',
        className
      )}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'shrink-0 flex flex-col-reverse gap-2 border-t border-border/60 pt-3 sm:flex-row sm:justify-end max-sm:[&_button]:min-h-11',
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-snug font-semibold text-surface-950 break-words', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-surface-600 break-words', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
