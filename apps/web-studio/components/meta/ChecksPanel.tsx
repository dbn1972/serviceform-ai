export type CheckIssue = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  targetId?: string;
};

export function ChecksPanel({ issues }: { issues: readonly CheckIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return (
    <aside className="sf-designer-pane" aria-label="Checks">
      <div className="sf-designer-pane-title">
        <h2 className="ux4g-label-l-strong">Checks</h2>
        <p className="ux4g-body-s-default">
          {errors.length} error{errors.length === 1 ? '' : 's'} · {warnings.length} warning
          {warnings.length === 1 ? '' : 's'}
        </p>
      </div>
      {issues.length === 0 ? (
        <p className="ux4g-body-s-default sf-designer-muted">No issues. Ready to save.</p>
      ) : (
        <ul className="sf-designer-check-list">
          {issues.map((issue) => (
            <li
              key={`${issue.code}:${issue.targetId ?? 'pack'}:${issue.message}`}
              className={
                issue.severity === 'error' ? 'sf-designer-check-error' : 'sf-designer-check-warning'
              }
            >
              <span className="ux4g-label-s-strong">{issue.code}</span>
              <span className="ux4g-body-s-default">{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
