A builder implements the bead here, on branch `yard/<bead>` in the bead's own
worktree.

Before the bead leaves as `done`:

- the work is committed on the branch, and the depot's light gate passes on
  the last commit (`yardr depot check <depot> --light --dir <worktree>`). The
  full gate runs once, on what lands; it is yours only for a change the
  light gate cannot see (the builder's role says which);
- a note on the bead says what changed, what was verified (the exact
  commands) and what was not verified, and ends with the gate line: the
  command, the commit it ran on, the result.

Outcomes:

- `done`: both hold. The bead goes to review.
- `question`: you are stuck, or the bead itself is unclear (an unclear goal,
  a design choice). Note the question on the bead first; it goes to `decide`,
  to a human.

The edge back to `backlog` has no outcome: the yardmaster takes a bead back with
`yardr bead advance <id> --to backlog` when it has to be reshaped.
