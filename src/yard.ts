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
  // Only a person moves a bead on from here.
  human?: boolean;
  terminal?: boolean;
}

export interface Group {
  name: string;
  // manual is people; any other runner starts sessions.
  runner: string;
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
  // The session working the bead now.
  session?: string;
  // The train a wagon belongs to.
  train?: string;
  labels?: string[];
  priority: number;
  created_at: string;
}
