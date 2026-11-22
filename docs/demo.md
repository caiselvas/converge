# Demo script (about 3 minutes)

Start both servers (`make dev`) and open <http://localhost:3000>. Reset first: `···` → *Reset demo to UBS starting point*. All numbers below come from the engine at the time of writing. If you change defaults, they will differ, which is the point.

**1. Two independent futures (30 s)** — *Overview, viewing as Nina*

- Two separate lines: Nina (CHF 287k cash) and Emil (CHF 157k), both loaded from UBS records P00918 and P00809. The status is *On track*, and "All accounting checks pass" sits top right.
- *Personal* → Nina's spending categories are estimated from 24 months of transactions. Open "Where do these numbers come from?" to show the ledger reconciles to CHF 0.00 against the cash-balance file. Point out that tax is an explicit assumption because the ledger has none.

**2. Connect their finances (30 s)** — *Scenarios*

- *Try a decision* → **Buy a home together → Add** (CHF 1.4M in Zurich, 25% deposit, April 2028, moving in April 2027).
- Both lines drop at the purchase: the deposit becomes equity, not lost wealth (toggle *Net worth* on Overview to show this). The plan stays *On track*.
- Optional: on *Together*, drag the deposit to 20%. The indicative affordability test fails, and the card shows the highest price that passes.
- **Propose to Emil.** Switch the viewer to **Emil** → *Proposals* → review the impact → **Approve**. Version v1 is now the agreed plan.

**3. Introduce a conflict (30 s)** — *Scenarios, as Emil*

- Career break: **Emil, January 2028, 6 months, 0% income, CHF 8,000 costs → Add Emil's break.**
- The status flips to **Conflict**. Emil's cash falls about CHF 17k below his CHF 24k minimum in June 2028, shown as the red dot. Open **Why?**: home deposit, income paused, break costs.
- Note the household as a whole is fine — Nina still has a cushion of about CHF 168k. This is exactly the conflict a pooled view would hide.

**4. Find alternatives (45 s)**

- *Ways to make it work*: about 900 alternatives evaluated, three verified options that use different levers. For example: *Nina funds 55% of the deposit (and owns 55%)*, *Emil keeps 40% of income during the break*, or a combined option.
- **Preview** one: the whole page recalculates and nothing is saved. Open *Why this works* to show what it resolves, its trade-offs and its assumptions.
- **Accept** → the change is added to the draft, and the bar at the bottom shows the before/after for both partners.

**5. Mutual decision (20 s)**

- **Propose to Nina** (the shared change needs her). Switch to **Nina** → *Proposals* → review the impact → **Approve**. The Overview shows *On track*, with a "Tight, but feasible" note for Emil.

**6. Stress test (25 s)** — *Scenarios, as Nina*

- Stress test → mortgage rate **1.8% → 4%**. The agreed plan breaks again: Emil is a few hundred francs short in June 2028. *Why?* now includes mortgage interest. The recommendations update immediately (for example, a slightly lower deposit or a later break).
- Close with *Assumptions & sources*: every number is UBS data, a cited source, or a labelled assumption. Language AI only translates and explains; it never calculates.
