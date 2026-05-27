/**
 * ProjectNotes -- inline markdown editor placeholder for project notes.
 * DB is authority, disk is read-only projection.
 * Uses @uiw/react-md-editor (already in package.json).
 */

import { useState, memo } from 'react';
import { Btn } from '@/ui';

export interface ProjectNotesProps {
  initialContent?: string;
  notesCount: number;
}

export const ProjectNotes = memo(function ProjectNotes({
  initialContent = '',
  notesCount,
}: ProjectNotesProps) {
  const [content, setContent] = useState(initialContent);
  const [editing, setEditing] = useState(false);

  return (
    <div className="alm-project-notes" role="region" aria-label="Project notes">
      <div className="alm-project-notes__header">
        <span className="alm-project-notes__title">
          Notes ({notesCount})
        </span>
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Done' : 'Edit'}
        </Btn>
      </div>
      <div className="alm-project-notes__body">
        {editing ? (
          <textarea
            className="alm-project-notes__editor alm-mono"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write project notes in markdown..."
            aria-label="Project notes editor"
            rows={8}
          />
        ) : (
          <div className="alm-project-notes__preview">
            {content ? (
              <pre className="alm-project-notes__content alm-mono">{content}</pre>
            ) : (
              <span className="alm-project-notes__placeholder">
                No notes yet. Click Edit to add notes.
              </span>
            )}
          </div>
        )}
      </div>
      <div className="alm-project-notes__footer">
        <span className="alm-project-notes__hint">
          DB is authority. Disk projections are read-only.
        </span>
      </div>
    </div>
  );
});
