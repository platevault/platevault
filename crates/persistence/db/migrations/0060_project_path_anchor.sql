-- Migration 0060: anchor legacy relative project paths (root-anchor fix)
--
-- `projects.path` is consumed as an absolute path by every reader (spec-011
-- tool-launch cwd, artifact watcher, spec-024 manifests, scaffolding mkdir
-- executor), but the creation wizard used to submit a library-relative path
-- ('projects/<slug>') that was stored verbatim — downstream consumers then
-- silently resolved it against the process CWD. Creation now anchors relative
-- paths to the registered project folder (registered_sources.kind =
-- 'project'); this migration applies the same anchor to existing rows,
-- best-effort:
--   * only when a project-kind registered source exists (earliest wins);
--   * only rows that are not already absolute (POSIX '/', drive 'X:', UNC/
--     root-relative '\');
--   * skipped when the anchored value would collide with an existing
--     projects.path (UNIQUE constraint) — such rows keep their legacy value.
-- Rows left relative (no project root registered) behave exactly as before;
-- they were already unlaunchable/unwatchable and remain visibly so.

UPDATE projects
SET path = (
        SELECT rtrim(rs.path, '/\') || '/' || projects.path
        FROM registered_sources rs
        WHERE rs.kind = 'project'
        ORDER BY rs.created_at ASC, rs.id ASC
        LIMIT 1
    )
WHERE EXISTS (SELECT 1 FROM registered_sources WHERE kind = 'project')
  AND path NOT LIKE '/%'
  AND path NOT LIKE '_:%'
  AND path NOT LIKE '\%'
  AND NOT EXISTS (
        SELECT 1 FROM projects p2
        WHERE p2.path = (
            SELECT rtrim(rs.path, '/\') || '/' || projects.path
            FROM registered_sources rs
            WHERE rs.kind = 'project'
            ORDER BY rs.created_at ASC, rs.id ASC
            LIMIT 1
        )
  );
