# Demo script (about 3 minutes)

Start both servers (`make dev`) and open <http://localhost:3000>. Reset first: `···` → *Reset demo to UBS starting point*. All numbers come from the engine. The ones quoted here are what it produced at the time of writing.

Everything happens on one screen. The parts are:

- the headline (does the plan work?)
- the decision buttons
- one chart
- the "Ways to make it work" cards
- the **Nina · Together · Emil** row, where each card opens an editable side panel and the chart stays visible.

**1. Two independent futures (30 s)** — viewing as Nina

- The headline reads "Your plan works for both of you." The chart shows Nina's cash (CHF 287k) and Emil's (CHF 157k) on separate lines, loaded from UBS profiles P00918 and P00809.
- Click **Nina**: her budget comes from 24 months of transactions. Open *Restaurants* and lower it — the chart and headline update live. Click **Discard** to undo. *About this data* (at the bottom of the panel) shows that the ledger reconciles to CHF 0.00.

**2. Connect their finances (30 s)**

- Click **Buy a home**. The shared panel opens with a CHF 1.4M home in Zurich, a 25% deposit, a purchase in April 2028 and moving in together in April 2027.
- Point out the drop in both lines at the purchase: the deposit turns into equity (switch the chart to *Net worth*). The plan stays *On track*. Optional: drag the deposit to 20% → the affordability check fails and shows the highest price that would pass.
- **Propose to Emil** → switch the viewer to **Emil** → **Proposals** → **Approve**.

**3. Introduce a conflict (30 s)** — viewing as Emil

- **Career break** → Emil, January 2028, 6 months, 0% income, CHF 8,000 costs → **Add**.
- The headline changes to: *"Emil's savings fall below the safety buffer in Jun 2028."* He is CHF 17,183 short. Click **Why?** to see the drivers: home deposit, paused income, break costs. Nina still has about CHF 168k of cushion, which is exactly the conflict a pooled household view would hide.

**4. Find alternatives (45 s)**

- *Ways to make it work*: 889 options simulated, and three verified options using different levers. For example: *Nina funds 55% of the deposit*, *Emil keeps 40% of income during the break*, and a combined option.
- **Preview** → the whole screen recalculates without saving anything. Click **Why?** on a card to see its reasoning and trade-offs. **Accept** adds it to the draft.

**5. Mutual decision (20 s)**

- **Propose to Nina** → switch to **Nina** → **Proposals** → review the impact → **Approve**. The headline returns to "Your plan works for both of you", with Emil's tightest moment shown at CHF 1,356 above his buffer.

**6. Stress test (25 s)** — viewing as Nina

- **Stress test** → mortgage rate **1.8% → 4%**. The agreed plan breaks again: Emil is CHF 376 short in June 2028. *Why?* now includes mortgage interest, and new fixes appear straight away.
- Optional: type *"What if the mortgage rate rises to 3.5%?"* into the input field. It turns into a structured, validated change (Claude when a key is configured, otherwise the built-in parser).
- Close with **Assumptions & sources** in the footer: every number is UBS data, a cited source or a labelled assumption.
