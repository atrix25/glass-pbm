/**
 * The four scripted members, described for the UI.
 *
 * Kept separate from the seed script so pages can import them without pulling
 * in the generator.
 */
export interface DemoMemberStory {
  id: string;
  name: string;
  tag: string;
  story: string;
  /** A question worth asking the AI agent about this member. */
  prompt: string;
}

export const DEMO_MEMBER_STORIES: DemoMemberStory[] = [
  {
    id: "mbr-DEMO-0001-01",
    name: "Margaret Olson",
    tag: "out-of-pocket cap",
    story:
      "Four chronic conditions and one Level 3 brand. Reaches the $600 prescription out-of-pocket limit partway through the year, and keeps paying on the Level 3 drug afterwards because Level 3 cost share never counted toward that limit.",
    prompt: "Why am I still paying for my prescriptions after hitting my $600 limit?",
  },
  {
    id: "mbr-DEMO-0002-01",
    name: "David Krueger",
    tag: "PA approved",
    story:
      "Plaque psoriasis on Skyrizi. The first fill rejected for prior authorization; the request approved at step 7 of the published criteria after a documented methotrexate trial.",
    prompt: "Was my Skyrizi prior authorization approved, and how long does it last?",
  },
  {
    id: "mbr-DEMO-0003-01",
    name: "Jennifer Vang",
    tag: "PA denied",
    story:
      "Same drug and same diagnosis as David, denied at step 8. No trial of phototherapy, methotrexate, or acitretin and no contraindication documented. A second, expedited request with contraindications documented was approved.",
    prompt: "Why was my Skyrizi request denied when my doctor prescribed it?",
  },
  {
    id: "mbr-DEMO-0004-01",
    name: "Thomas Meyer",
    tag: "edge cases",
    story:
      "The rejects worth explaining out loud: a refill too soon, a brand chosen over an available generic, a fill at an out-of-network pharmacy, a quantity over the plan limit, and one claim where the pharmacy's cash price came in under the contract rate.",
    prompt: "My pharmacy said my refill was too soon. When can I pick it up?",
  },
];

export const DEMO_MEMBER_BY_ID = Object.fromEntries(
  DEMO_MEMBER_STORIES.map((m) => [m.id, m]),
);
