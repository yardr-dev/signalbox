New beads wait here, where `yardr bead create` puts them, until the yardmaster
has shaped them. No agent works this stage.

A bead leaves for `new` when it is specified well enough for a builder to
finish it without asking: a clear goal, where to look, what done means, how
to test. A large bead is split first, and `yardr dep add <blocker> <bead>`
orders the parts: a bead is only ready once its blockers are closed.

The stage has no outcomes; whoever shapes the bead moves it:

- to `new`, once the above holds: `yardr bead advance <id> --to new`;
- to `decide`, when what the bead should be is mckean's to decide: the
  question and the options go into the bead first
  (`yardr bead advance <id> --to decide`).
