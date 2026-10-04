import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class HistoricalAdrNumbering(unittest.TestCase):
    def test_numbering_preserves_history_and_check_is_read_only(self):
        repo = Path(__file__).resolve().parents[4]
        for runtime in (".claude", ".codex"):
            with self.subTest(runtime=runtime), tempfile.TemporaryDirectory() as directory:
                source = repo / runtime / "hooks/adr-as-beads/scripts/render_adrs.py"
                spec = importlib.util.spec_from_file_location("renderer", source)
                renderer = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(renderer)
                root = Path(directory)
                target = root / "docs/adr"
                target.mkdir(parents=True)
                historical = target / "0001-historical.md"
                historical.write_text("# Historical frontend boundary\n")
                second = target / "0002-other-decision.md"
                second.write_text("# Independent historical decision\n")
                note = target / "README.md"
                note.write_text("# Notes\nExample banner: " + renderer.GENERATED_MARKER + "\n")
                obsolete = target / "0001-new-decision.md"
                obsolete.write_text(renderer.GENERATED_MARKER + " old projection -->\n")
                before = {path.name: path.read_bytes() for path in target.iterdir()}
                decisions = [{"id": "new", "title": "New decision", "status": "closed", "created_at": "2026-10-04", "description": "## Decision\nRust owns calculation."}]
                with patch.object(renderer, "export_decisions", return_value=decisions):
                    paths, reason = renderer.render_all(root, write=False)
                    self.assertIsNone(reason)
                    self.assertEqual({path.name for path in paths}, {"0001-new-decision.md", "0003-new-decision.md"})
                    self.assertEqual({path.name: path.read_bytes() for path in target.iterdir()}, before)
                    renderer.render_all(root)
                    self.assertFalse(obsolete.exists())
                    self.assertEqual(historical.read_bytes(), before[historical.name])
                    self.assertEqual(second.read_bytes(), before[second.name])
                    self.assertEqual(note.read_bytes(), before[note.name])
                    self.assertIn("number: 3\n", (target / "0003-new-decision.md").read_text())
                    self.assertEqual(renderer.render_all(root), ([], None))
                    self.assertEqual(renderer.render_all(root, write=False), ([], None))
                with patch.object(renderer, "export_decisions", return_value=[]):
                    snapshot = {path.name: path.read_bytes() for path in target.iterdir()}
                    stale, reason = renderer.render_all(root, write=False)
                    self.assertIsNone(reason)
                    self.assertEqual({path.name for path in stale}, {"0003-new-decision.md"})
                    self.assertEqual({path.name: path.read_bytes() for path in target.iterdir()}, snapshot)
                    renderer.render_all(root)
                    self.assertEqual({path.name for path in target.iterdir()}, {historical.name, second.name, note.name})
                    self.assertEqual(note.read_bytes(), before[note.name])


if __name__ == "__main__":
    unittest.main()
