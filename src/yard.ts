// The shape of public/yard.json, as scripts/snapshot.sh writes it: the
// structure of one yard, cut down to what the picture needs. A field yardr
// leaves out when unset is optional here.

export interface Yard {
  taken_at: string;
  depots: Depot[];
  // In the order of depots, one entry per depot.
  flows: DepotFlows[];
  groups: Group[];
  // In match order, as yardr route list prints them.
  routes: Route[];
  crew: CrewMember[];
  peers: Peer[];
  // The open beads.
  beads: Bead[];
  // The blocks edges that touch an open bead. A snapshot taken before the
  // page drew them has none.
  edges?: Edge[];
}

export interface Depot {
  name: string;
  kind: string;
  base?: string;
}

export interface DepotFlows {
  depot: string;
  flows: Flow[];
}

export interface Flow {
  name: string;
  // The bead type the flow is for; the depot's default flow has none.
  type?: string;
  stages: Stage[];
}

export interface Stage {
  stage: string;
  // The group the stage is routed to, as flow show resolved it.
  group?: string;
  // The stages a bead can move to from here, as the flow's transitions say.
  next?: string[];
  // Only a person moves a bead on from here.
  human?: boolean;
  terminal?: boolean;
}

export interface Group {
  name: string;
  // manual is people; any other runner starts sessions.
  runner: string;
  // The agent its sessions are (claude, codex, kimi): the provider whose
  // quota they burn. A group of people or of scripts has none.
  kind?: string;
  limit: number;
  members?: string[];
}

export interface Route {
  stage: string;
  type?: string;
  depot?: string;
  label?: string;
  group: string;
  priority: number;
}

export interface CrewMember {
  name: string;
  // The agent it is, as a group's kind.
  kind?: string;
  state?: string;
  status?: string;
}

export interface Peer {
  name: string;
  send?: string[];
  receive?: string[];
}

export interface Bead {
  id: string;
  title: string;
  type: string;
  stage: string;
  depot: string;
  group?: string;
  // Whether a running session is working the bead now.
  working?: boolean;
  // Held: set aside until someone lets it go on.
  hold?: boolean;
  // What went wrong with it last and nothing has put right since.
  fault?: Fault;
  // The train a wagon belongs to.
  train?: string;
  labels?: string[];
  priority: number;
  created_at: string;
  // When it last moved to another stage, where that is known: a bead that
  // never moved, or moved before the window of the log, has none.
  moved_at?: string;
}

// A blocks edge between two beads: from must close before to is ready, so to
// waits for from. An edge stays when its blocker has closed: a bead waits
// only for one that is still open.
export interface Edge {
  from: string;
  to: string;
}

// A fault on a bead. Its kind is how the bead's session ended when that was
// not well (stalled, blocked, harness_error, prompt_gave_up, gave_up, a
// session's last state such as died or failed, ended_<outcome> for an
// advance with another outcome than done), or what
// the yard said of the bead itself: move_refused, stranded, unrouted. A hold
// is no fault of this kind: hold says it.
export interface Fault {
  kind: string;
  at: string;
}

// The shape of public/quota.json, beside yard.json: what is left of each
// provider's quota, as aiquokka --json said when the snapshot was taken.
export interface Quota {
  taken_at: string;
  // The providers that have a window of a week or of five hours.
  providers: Provider[];
}

export interface Provider {
  // As a group's kind names it: claude, codex, kimi.
  key: string;
  // As it is written: Claude.
  name: string;
  plan?: string;
  // The window of a week, and the one of five hours: the first of each the
  // provider has.
  weekly?: Allowance;
  short?: Allowance;
}

export interface Allowance {
  used_percent: number;
  // When the window starts again, where the provider says.
  resets_at?: string;
}
