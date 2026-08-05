export type Role = "sponsor" | "member" | "pharmacy" | "admin";

export interface RoleDefinition {
  id: Role;
  label: string;
  who: string;
  blurb: string;
  landing: string;
}

export const ROLES: RoleDefinition[] = [
  {
    id: "sponsor",
    label: "Plan sponsor",
    who: "Steel Potatoes LLC — Benefits Director",
    blurb:
      "See the whole book: what the plan paid, what the pharmacy received, what the contract guaranteed, and where the two diverge.",
    landing: "/sponsor",
  },
  {
    id: "admin",
    label: "Benefit administrator",
    who: "Glass — Account Management",
    blurb:
      "Change the benefit and watch every affected claim re-adjudicate before the change is committed.",
    landing: "/changes",
  },
  {
    id: "member",
    label: "Member",
    who: "Margaret Olson — Madison, WI",
    blurb:
      "Ask a question in plain language and get an answer with the rule, the number, and the source behind it.",
    landing: "/assistant",
  },
  {
    id: "pharmacy",
    label: "Pharmacy",
    who: "Walgreens #4471 — point of sale",
    blurb:
      "Submit a claim the way a pharmacy does and read the full adjudication response.",
    landing: "/pos",
  },
];

export const ROLE_BY_ID = Object.fromEntries(
  ROLES.map((r) => [r.id, r]),
) as Record<Role, RoleDefinition>;

export const DEFAULT_MEMBER_ID = "mbr-DEMO-0001-01";
