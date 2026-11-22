# Converge demo · a home, then Emil’s career break

## Prepare

Open **··· → Load demo state**. This resets the workspace to the UBS starting point with the couple’s agreed CHF 1’400’000 home in April 2028. Its indicative affordability ratio is 31.7% of their usual net income.

## 1 · Overview

Overview shows the agreed plan only. You see its status, the 120-month projection, each partner’s lowest cash against their safety buffer, household net worth in 2036, and **In your plan**, which lists the agreed home. There are no shortcut buttons: decisions start in Goals.

## 2 · Explore the home (Goals → Buy a home)

The planner opens with three essentials, prefilled from the plan: price, purchase month and who pays the deposit. Converge compares straight away. Your plan stays safe, and Converge still tests alternatives: a **CHF 1’200’000 home** (*Most wealth in 10 years*) and **Buy in Apr 2029** (*Safest for both*). Every option is a line on one chart. Drag the month slider to compare any point in time, and switch the chart to Nina’s or Emil’s cash to see each buffer. Select **Add an option** and set the price to CHF 1’300’000 to add your own option.

Under **What matters to you**, viewing as Nina, set **Purchase date** to **The date is essential to me**.

## 3 · Plan the break (Goals → Take a career break)

Switch **Viewing as** to Emil. Set January 2028, 12 months and 0% pay kept. You can also open **Ask** and type “Emil takes 12 months off from Jan 2028 with CHF 8k in fees”. In **What matters to you**, Emil says he could start later and could work part-time. Then switch to Nina and choose **Keep our usual split**.

Your plan now fails: Emil’s cash falls below his buffer in June 2028 and is CHF 22’040 short in December. Nina keeps CHF 188’162 above her buffer at her cash low. Because the plan fails a safety check, the recommendation engine adds three verified fixes. All three keep the home date that Nina called essential.

| Option | Mortgage rate it holds up to | Income drop it holds up to |
| --- | ---: | ---: |
| Emil keeps 20% of usual pay by working part-time | 2.2% | 1.0% |
| Nina funds 60% of the deposit and owns 60% | 7.9% | 4.9% |
| Emil starts in January 2029 | 8.1% | 4.9% |

Ask the assistant “Why does the safest option protect Emil better?”. With an agent model configured it answers from the engine’s figures for these options. Without one, it lists what the engine shows.

## 4 · Stress, choose and approve

Set the mortgage rate to **4%** in **Stress test**. The same options stay on screen, and two of the three still pass; the part-time option falls below Emil’s buffer. Select the January 2029 option and choose **Choose and propose to Nina**. Switch to Nina and **Approve** it from **Proposals**. Back on Overview the projection reflects the agreed plan, still at its **1.8%** mortgage assumption: the stress test never reaches a proposal.

Run `PYTHONPATH=app/backend app/backend/.venv/bin/python scripts/demo_check.py` to replay these comparisons and the engine checks.
