import { toast } from 'sonner';

export type ToastType = 'success' | 'error' | 'info';

// Module-level so `addToast` has a STABLE identity across renders. Several
// components list it (directly or via a useCallback chain) in effect deps —
// e.g. ModelsSettingsSection's mount effect depends on fetchModels which
// depends on addToast. When this was a render-scoped closure, every parent
// re-render (SettingsView polls status every 30s) re-fired those effects,
// re-running load() and resetting unsaved form state mid-edit.
function addToast(message: string, type: ToastType = 'info', _duration?: number) {
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
}

export function useToast() {
  return { addToast };
}
