summary: Base landings are deployed from here, one bead at a time.

The bead has landed: its commit is on the depot's base, or on its train's
branch. A base landing is deployed from here, by a deploy script, one bead at
a time. Nothing about the bead or the base is changed here.

What is deployed is the base as it stands when the script runs, which may
hold a later landing than this bead's. A bead that landed on a train's
branch deploys nothing: the train does, when it lands on the base.

A bead here with no route waits until the yard routes the stage.

Outcomes:

- `done`: the base is running, or the bead landed on a train's branch. The
  note names the commit that is running and its address, or the train, and
  `live` closes the bead.
- `failed`: the host refused the push or the build. The code has landed, so
  only the host can be fixed: the note carries the end of the host's output,
  and the bead goes to `decide`.
