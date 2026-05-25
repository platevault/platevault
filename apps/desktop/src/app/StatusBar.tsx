import { useLogPanel } from './LogPanelContext';
import { useOperationStatus } from './OperationStatusContext';

export function StatusBar() {
  const { toggle } = useLogPanel();
  const { statusLabel } = useOperationStatus();

  return (
    <button
      type="button"
      className="alm-statusbar"
      onClick={toggle}
      aria-label="Toggle log panel"
    >
      <span className="alm-statusbar__text">{statusLabel}</span>
    </button>
  );
}
