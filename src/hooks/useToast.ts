import { toast } from 'sonner';

export type ToastType = 'success' | 'error' | 'info';

export function useToast() {
  const addToast = (message: string, type: ToastType = 'info', _duration?: number) => {
    const opts = _duration ? { duration: _duration } : undefined;
    switch (type) {
      case 'success':
        toast.success(message, opts);
        break;
      case 'error':
        toast.error(message, opts);
        break;
      case 'info':
        toast.info(message, opts);
        break;
    }
  };

  return { addToast };
}
