summary: The approved bead is landed on the depot's base from here, one bead at a time.

The approved bead is landed on the depot's base from here, one bead at a time:
by an assembly script or by a person merging by hand, as the yard is set up.
The bead was built, reviewed and approved; nothing about it is changed here
beyond rebasing `yard/<bead>` onto the base when the base moved.

Before the bead leaves as `done`, the depot's gate has passed on exactly the
commit that lands (`yardr depot check <depot> --dir <worktree>`), whatever the
builder and the reviewer reported, and the base is at that commit.

Outcomes:

- `done`: the commit is on the base. The note names it (`merged <sha>`), and
  `merged` closes the bead.
- `failed`: the gate is red on what would land, or the branch no longer
  applies on the base (a rebase that conflicts: this flow has no `merge`
  stage). The note carries the end of the gate's output or the conflicting
  files, and the bead goes back to `new`.
- `question`: landing it needs a person's decision; the note has the question
  and the options, and the bead goes to `decide`.

Hold the bead instead (`yardr bead hold <id>`, with a note) when no builder
could fix what stopped it: the gate could not run at all, or a checkout that
would have to move is dirty.
