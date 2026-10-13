summary: What has landed on the base is deployed from here, one bead at a time.

The bead has landed: its commit is on the depot's base. From here the base
is deployed to where the page runs, by a deploy script, one bead at a time.
Nothing about the bead or the base is changed here.

What is deployed is the base as it stands when the script runs, which may
hold a later landing than this bead's. A bead that landed on a train's
branch deploys nothing: the train does, when it lands on the base.

A bead here with no route waits: the yard has no deploy group for the stage
yet, and the bead starts when one is routed.

Outcomes:

- `done`: the base is running, or the bead landed on a train's branch. The
  note names the commit that is running and its address, or the train, and
  `live` closes the bead.
- `failed`: the host refused the push or the build. The code has landed, so
  only the host can be fixed: the note carries the end of the host's output,
  and the bead goes to `decide`.
