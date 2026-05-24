import { useLogPanel } from './LogPanelContext';

export function StatusBar() {
  const { toggle } = useLogPanel();

  return (
    <button
      type="button"
      className="alm-statusbar"
      onClick={toggle}
      aria-label="Toggle log panel"
    >
      <span className="alm-statusbar__text">Idle</span>
    </button>
  );
}
