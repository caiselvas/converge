# Converge demo · Emil’s career break

## Prepare

Open **··· → Load demo state**. This resets the workspace to the UBS starting point with the couple’s agreed CHF 1’400’000 home in April 2028. Its indicative affordability ratio is 31.7% of their usual net income. Under **Viewing as Nina**, open the home planner’s **Brief** and set **Purchase date** to **The date is essential to me**.

## Plan the break

Switch **Viewing as** to Emil and open **+ Career break** on Overview. Choose Emil, January 2028, 12 months, 0% pay kept and CHF 8’000 in one-off costs. You can also open Ask and enter “Emil takes 12 months off from Jan 2028 with CHF 8k in fees” to fill those fields in the same planner.

Say the break gives Emil time to retrain, that he could start later, and that he could work part-time. In the brief, switch to Nina and choose **Keep our usual split** for household support.

## Compare

Open **Compare options**. In **Your plan**, Emil’s cash falls below his buffer in June 2028 and is CHF 22’040 short in December. Nina has CHF 188’162 above her buffer at her cash low. The home date stays fixed across the alternatives. The engine verifies three safe options in the 120-month projection.

| Option | Mortgage rate it holds up to | Income drop it holds up to |
| --- | ---: | ---: |
| Emil keeps 20% of usual pay by working part-time | 2.2% | 1.0% |
| Nina funds 60% of the deposit and owns 60% | 7.9% | 4.9% |
| Emil starts in January 2029 | 8.1% | 4.9% |

Show the comparison in **Together** for household net worth or in **Emil** scope for his cash and safety buffer. On a phone, swipe the options across.

## Stress, choose and approve

Set the mortgage rate to **4%** in the comparison’s **Stress test**. Two of the three alternatives still pass. The 20% part-time option falls below Emil’s buffer. Choose the January 2029 break or the ownership option that still passes. Switch to the other partner and **Approve** it from **Proposals**. Clear the stress overlay to see the agreed plan at its original **1.8%** mortgage assumption.

Run `PYTHONPATH=app/backend app/backend/.venv/bin/python scripts/demo_check.py` to replay the comparison and the existing engine checks.
