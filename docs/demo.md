# Demo script

Start both servers (`make dev`) and open <http://localhost:3000>. Reset first: `···` → *Reset demo to UBS starting point*. All numbers come from the engine. The ones quoted here are what it produced at the time of writing.

To replay the numbers without starting either server, run `PYTHONPATH=app/backend app/backend/.venv/bin/python scripts/demo_check.py` from the repository root.

## Main demo (about 3 minutes)

1. Open **What if** as Emil. The first comparison tests living together using the agreed plan as the baseline. Point out the two cash buffers and the combined net-worth figure. A household can hold enough assets overall while one partner runs short of cash.
2. Keep **Live together**, select **Buy the planned home**, then choose **Fine Arts MA** for Emil in September 2027 with 0% pay retained. Leave the sourced fees and the zero post-study pay change. Run the comparison. Emil’s buffer shortfall is CHF 82,866 in August 2029, even with positive combined net worth. Switch to **Quantitative Finance MSc** and rerun. With the same pay assumptions, the shorter programme moves the deepest shortfall to February 2029 and reduces it to CHF 62,112.
3. Keep one programme and try sharing expenses by actual income during study. Show what that change does for each person. Expand the sensitivity assumptions and the accounting checks. If you want to pursue the change, use **Add scenario to draft** and show the existing proposal workflow.
4. On your phone, open **Agent → Voice call → Start call** from the HTTPS demo URL. Say “I want to study Fine Arts in September 2027 and buy our planned home. I want more creative work, and I need to protect my cash buffer.” Answer a follow-up, end the call, then use **Review your profile** to see the saved observations. **Continue in chat** is available on the same screen.

## Original home, career break and approval demo

Use **Plan** for the verdict, decisions, recommendations and chart. **Goals** and **Expenses** keep a live verdict above the editor. The scope control follows you across those three pages.

**1. Two independent futures (30 s)** — viewing as Nina

- The headline reads "Your plan works for both of you." The chart shows Nina's opening cash (CHF 286’652) and Emil's (CHF 157’059) on separate lines, loaded from UBS profiles P00918 and P00809.
- Select **Nina** and open **Expenses**. Lower *Restaurants* and watch the lowest-cash chip update. Click **Discard** to undo. *About this data* shows reconciliation to CHF 0.00. Return to **Plan** in **Together** scope.

**2. Connect their finances (30 s)**

- Click **+ Buy a home**. **Goals** opens with a CHF 1.4M home in Zurich, a 25% deposit, a purchase in April 2028 and moving in together in April 2027.
- Return to **Plan** and point out the drop in both lines at the purchase as the deposit turns into equity (switch the chart to *Net worth*). The plan stays *On track* with imputed housing costs at 31.7% of combined usual net income. Optionally, reduce the deposit to 20% to show the affordability limit, then restore it to 25%.
- **Propose to Emil** → switch the viewer to **Emil** → **Proposals** → **Approve**.

**3. Introduce a conflict (30 s)** — viewing as Emil

- **+ Career break** → Emil, January 2028, 12 months, 0% income, CHF 8’000 costs → **Add**.
- Emil first breaches his buffer in June 2028. The headline shows his lowest point in December 2028, when he is CHF 22’040 short. Click **Why?** to see the deposit, lost income and break costs. Nina still has CHF 188’162 above her buffer at her tightest point.

**4. Find alternatives (45 s)**

- The engine evaluates 895 candidates and shows three verified options. Nina can fund and own 60%, Emil can keep 20% of his income by working part-time during the break, or they can lower the deposit to 23% and move the break to January 2029.
- On **Stay on schedule**, click **Preview** to try the part-time break. Click **Why?** on the card to see the trade-offs, then **Accept** to add it to the draft.

**5. Save Emil's revised break (20 s)**

- Click **Save to my plan** as Emil. The headline returns to "Your plan works for both of you", with Emil's tightest moment at CHF 1’512 above his buffer.

**6. Stress test (25 s)** — viewing as Nina

- Switch to **Nina**, then open **Stress test** and raise the mortgage rate from **1.8% to 4%**. Emil first breaches his buffer in October 2028 and is CHF 6’171 short at his lowest point in December. Three new verified fixes appear. The **Stress** tag shows the temporary rate and clears it when reset.
- Optional: ask the **Agent** to test a 3.5% mortgage rate against the current draft. It can run the simulation without saving the rate.
- Close with **Assumptions & sources** in the footer: every number is UBS data, a cited source or a labelled assumption.


**Optional goal scenario** — after saving Emil’s revised break, use **Goals** in Emil’s scope to set *Career transition* to CHF 220’000 in December 2030, measured on cash plus investments. The home alone can fund it. With the part-time break it is CHF 46’451 short at the deadline and slips to July 2031. The recommendation cards include an explicit concession to move the target.
