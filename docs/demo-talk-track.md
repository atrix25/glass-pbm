# Glass live demo — talk track

**Time:** ~12–15 minutes (leadership rail)  
**Path:** Operations → Sponsor → Claims → Changes → Assistant → PA → Reports → Proof  
**One line before you share the screen:**  
“This isn’t a prototype UI on fake totals. It’s a working adjudication system on a mid-size book—about a hundred thousand members—running against a real published Wisconsin PBM contract. Every dollar on screen can show how it was calculated.”

---

## What was built (30 seconds)

We built **Glass**: an end-to-end transparent pharmacy benefit manager proof of concept.

- A **real rules engine** that adjudicates claims (pay / reject / member cost share)
- A **full plan year** of activity for an invented employer, Steel Potatoes, sized like a real mid-market book
- **Claim-level derivation** — open any claim and read the arithmetic
- **Benefit-change replay** — change a rule, re-price affected claims before you commit
- **Prior auth, clinical DUR, settlement, guarantees, eligibility, agents** — not just a claims list
- **Methodology baked in** — what’s real, derived, or invented is labeled on purpose

**Anchor contract:** Wisconsin ETF / Navitus ETG0013 — rate card, formulary flags, clinical criteria, CMS NADAC. Public documents the engine actually runs.

---

## What’s impressive (say this once, early)

Don’t sell “AI.” Sell these five:

1. **It’s running, not mocked.** Tens of thousands of claims a week, live ops cut to “today,” clock advances the plan year.
2. **No stored magic totals.** Sponsor spend and reports roll up from claims; claims recompute from rules.
3. **Pass-through by construction.** Plan billed ties to pharmacy paid—you can check it on a claim.
4. **You can change the benefit and see the book move**—exact re-adjudication, not a slide estimate.
5. **It shows its work and its limits.** Proof page, methodology, and honest gaps—so skeptics have somewhere to push.

Then: “Members and fills are synthetic. The adjudication is not.”

---

## Opening (role pick)

**Do:** Land on the sign-in screen. Point at live book stats.

**Say:**  
“Steel Potatoes is invented. The membership is invented. What isn’t invented is the engine: same path a live claim would take. We’re going to walk it the way a benefits leader would—then open the hood.”

**Click:** Plan sponsor (or Benefit administrator if you’ll emphasize Changes).

---

## Stop 1 — Operations (`/operations`)

**Claim on the rail:** *A hundred thousand lives, and what happened on them this morning.*

**Do:** Show today’s fills, PA waiting, YTD run rate. Optionally bump **+1 week** on the clock bar.

**Say:**  
“This is the plan as of this instant—not a finished annual report. The clock at the top is the cut line through the year. Advance it, and claims that haven’t happened yet disappear from ‘today.’ That’s how you know these aren’t hard-coded dashboard tiles.”

**Impressive beat:** Live system feel; time is real to the book.

---

## Stop 2 — Sponsor (`/sponsor`)

**Claim:** *What the plan spent, and where it went.*

**Do:** YTD spend, channel/level mix, trends, rejects, top drugs.

**Say:**  
“This is what a benefits director opens on Monday. Channel mix, rejects, top drugs—these add up from the claim ledger. If you changed how claims price, this page would move. That’s the difference between a BI export and a system.”

**Impressive beat:** Employer-grade view on a real working book (~$100M+ YTD scale in the demo—use the number on screen).

---

## Stop 3 — One claim (`/claims` → open any paid claim)

**Claim:** *Open any claim and read the arithmetic.*

**Do:** Open a claim. Scroll the derivation: lesser-of arms, NADAC/MAC/AWP as labeled, member pay, plan pay. Point at recompute if shown.

**Say:**  
“Pick any claim—not a golden path we pre-staged. Here’s ingredient cost, dispensing fee, which benchmark won, what the member owed, what the plan was billed. Pass-through means that billed amount should match pharmacy paid. You’re not supposed to take my word for it; the trace is the product.”

**Impressive beat:** This is the money slide. Pause. Let them read one line of math.

**If challenged “is this fake?”**  
“The person and the fill were generated. The dollars came out of the engine. That’s the whole thesis: *the population is invented; the adjudication is not.*”

---

## Stop 4 — Change the benefit (`/changes`)

**Claim:** *Move a copay and see every affected claim re-priced before you commit.*

**Do:** Propose a simple change (copay / specialty / something visible). Show affected claims / delta. Don’t need to commit if you don’t want to.

**Say:**  
“In a traditional PBM this is a six-week modeling exercise. Here we rebuild accumulators and re-adjudicate the affected book *before* commit. You’re seeing the cost of the decision, not a consultant’s estimate of the cost of the decision.”

**Impressive beat:** Replay / “what if” as an operational console—this is the commercial wedge for Caremark + employers.

---

## Stop 5 — Member assistant (`/assistant`)

**Claim:** *Answers from the rules engine, and shows its work.*

**Do:** Ask something concrete: why a reject, what’s my copay, deductible left. Show refusal on clinical advice if it fits.

**Say:**  
“This isn’t ChatGPT on a PDF. It calls the same tools the engine uses and has to show its work. Ask for medical advice—it should refuse and hand off. That’s intentional. We’re automating explanation, not practicing medicine.”

**Impressive beat:** Grounded agent, not a chatbot wallpaper.

---

## Stop 6 — Prior auth (`/pa` → open a case)

**Claim:** *Traverse published criteria; cite the deciding step.*

**Do:** Open a PA. Walk numbered steps to the deciding step.

**Say:**  
“Coverage decisions cite a step on a published form—not ‘clinical review complete.’ Only a subset of forms are fully transcribed today; the rest escalate to a pharmacist instead of guessing. That’s a limitation we’re proud to show, because the alternative is fake confidence.”

**Impressive beat:** Auditability of denials/approvals; honesty about coverage of criteria.

---

## Stop 7 — Reports (`/reports`)

**Claim:** *Guarantees, rebates, counterfactual vs a spread PBM.*

**Do:** Pricing guarantees, rebate waterfall, traditional-spread comparison, AWP sensitivity if visible.

**Say:**  
“This is where finance lives. Guarantees that can miss. Rebates as contractual floor—not pretend manufacturer invoices. And a counterfactual: what a spread PBM economics shape looks like next to pass-through. AWP is proprietary, so where we simulate it, we label it and run sensitivity—we don’t hide the opacity.”

**Impressive beat:** Contract reconciliation as a product surface, not a quarterly PDF.

---

## Stop 8 — Proof (`/proof`)

**Claim:** *Golden cases, invariants, criteria coverage.*

**Do:** Show golden tests / invariants / coverage. Optionally mention methodology (`/methodology`) or throughput if they ask “does it scale?”

**Say:**  
“A demo that only shows happy paths isn’t evidence. This page is from the last real test run—cases that must always hold, book-wide invariants, how much of the criteria tree we’ve actually covered. If you’re going to put this inside Caremark, this is the posture you want: prove it, don’t decorate it.”

**Impressive beat:** Engineering seriousness; skeptic-friendly close.

---

## Optional 60-second encore (if you have time)

| If they ask… | Go to… | One line |
|--------------|--------|----------|
| “Can pharmacies hit it?” | `/pos` | “Same engine; test transmit evaluated, not written.” |
| “Fraud / waste?” | `/integrity` | “Peer detectors—and we plant cases on purpose to stress them.” |
| “Money movement?” | `/settlement` | “Invoice, pharmacy pay, rebate aging—pass-through checked.” |
| “Agents beyond chat?” | `/agents` | “Six scoped agents; money and care-denying actions stay with humans.” |

---

## Close (45 seconds)

**Say:**  
“So what you’re looking at is a functioning transparent adjudication system: live book, claim-level derivation, benefit replay, PA you can cite, contract reports, and proof artifacts.

What’s impressive isn’t the chrome—it’s that the numbers are produced, not placed.

What’s next is the hard part: real Caremark feeds, real customers, dual-run, and a low-cost pass-through offer we co-build with employers for 1/1/28.

This demo is the existence proof. The roadmap is how we industrialize it.”

**Hard stop question to the room:**  
“If you could open any claim on your book tomorrow and see this level of derivation—what’s the first thing you’d verify?”

---

## Demo hygiene (for you, not the room)

- Prefer **guided demo rail** so you don’t wander.
- When someone says “this must be hardcoded,” **advance the clock** or **open a random claim**.
- Never oversell: say **proof of concept**, **synthetic membership**, **3 of 438 PA forms**, **rebate floor**, **not a live network**. Honesty is part of the impressiveness.
- If AI comes up: “Agents are scoped helpers. The product is the deterministic engine.”

---

## 90-second elevator (if you only get a hallway)

“We built a working transparent PBM on a hundred-thousand-life book. You can open any claim and see the math, change a benefit and re-price the book, walk a PA to the deciding step, and reconcile guarantees against a spread counterfactual. Membership is synthetic; adjudication against a real published contract is not. That’s the demo. Co-building with employers inside Caremark is the company.”
