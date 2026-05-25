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
      <span className="alm-statusbar__sep">&middot;</span>
      <span className="alm-statusbar__text">Last scan: 2h ago</span>
      <span className="alm-statusbar__sep">&middot;</span>
      <span className="alm-statusbar__text">142,318 files indexed</span>
      <span className="alm-statusbar__root">D:\Astrophotography</span>
    </button>
  );
}
