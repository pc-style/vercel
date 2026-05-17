---
'vercel': patch
---

CLI: address review comments on multi-account / named project link support.

- `vc pull` (`writeProjectSettings`) now preserves named entries in the
  `projects` map of `.vercel/project.json` instead of overwriting them when
  the file uses the new format.
- `vc link --name <X>` now also honors `--name` for repo-root cross-team
  matches by writing the named local link to `.vercel/project.json` in
  addition to `repo.json`.
- The global parser that picks a named local project link no longer reads
  `--project` (which conflicts with `vc link --project`). Use
  `--project-link <name>` to select a named link in other commands.
- New `vc accounts list` (`vc accounts ls`) subcommand to print locally
  configured Vercel CLI accounts, with `--json` for scripts.
