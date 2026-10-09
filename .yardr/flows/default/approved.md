summary: The approved bead is landed on the depot's base from here, one bead at a time.

The approved bead is landed on the depot's base from here, one bead at a time:
by an assembly script or by a person merging by hand, as the yard is set up.
The bead was built, reviewed and approved; nothing about it is changed here
beyond rebasing `yard/<bead>` onto the base when the base moved.

Before the bead leaves as `done`, the depot's test command has passed on
exactly the commit that lands, run in the worktree with `YARDR_LANDING=1`,
whatever the builder and the reviewer reported, and the base is at that
commit. Where the command is a script in the repository, it is the base's
copy that runs (`git show <base>:<script>`, with sh), so that no bead
changes what judges it. A depot with no test command lands untested, and the note
says so.

Outcomes:

- `done`: the commit is on the base. The note names it (`merged <sha>`), and
  `merged` closes the bead.
- `failed`: the tests are red on what would land, or the branch no longer
  applies on the base (a rebase that conflicts: this flow has no `merge`
  stage). The note carries the end of the tests' output or the conflicting
  files, and the bead goes back to `new`.
- `question`: landing it needs a person's decision; the note has the question
  and the options, and the bead goes to `decide`.

Hold the bead instead (`yardr bead hold <id>`, with a note) when no builder
could fix what stopped it: the tests could not run at all (the command says
so with exit 2), or a checkout that would have to move is dirty.
