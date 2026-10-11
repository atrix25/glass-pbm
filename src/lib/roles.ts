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
    who: "Employer benefits team",
    blurb:
      "Compare employer costs, member costs, and benefit choices.",
    landing: "/sponsor",
  },
  {
    id: "admin",
    label: "Caremark team",
    who: "Commercial and operations",
    blurb:
      "Model account economics and explore agent-assisted operations.",
    landing: "/business",
  },
  {
    id: "member",
    label: "Member",
    who: "Margaret Olson — Madison, WI",
    blurb:
      "Explore grounded member support using the synthetic reference book.",
    landing: "/assistant",
  },
  {
    id: "pharmacy",
    label: "Pharmacy",
    who: "Walgreens #4471 — point of sale",
    blurb:
      "Submit a reference claim and inspect its adjudication.",
    landing: "/pos",
  },
];

export const ROLE_BY_ID = Object.fromEntries(
  ROLES.map((r) => [r.id, r]),
) as Record<Role, RoleDefinition>;

export const DEFAULT_MEMBER_ID = "mbr-DEMO-0001-01";
