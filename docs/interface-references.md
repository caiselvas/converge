# Converge interface references

Researched and visually inspected on 2026-11-22. References are shipped products
and official product screenshots, rather than generated concept images. This
does not establish that every asset or every part of their development was
created without AI. Linear's documented designer-led process is particularly
strong evidence for the kind of deliberate interaction design requested.

## References and concrete lessons

| Reference | Evidence inspected | Pattern to adapt for Converge |
|---|---|---|
| [Linear timeline](https://linear.app/changelog/2024-02-29-milestones-on-the-timeline) | Enlarged timeline screenshot; milestone and chronology documentation | Aligned horizontal tracks, restrained grid, drag-to-reschedule, milestone grouping, precise date cursor |
| [Linear timeline documentation](https://linear.app/docs/timeline) | Official interaction descriptions | Switch time resolution, group lanes, selectively show dependencies and details |
| [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh) | Named designers' account of hierarchy and consistency | Stable action placement, quiet inactive controls, fewer competing borders |
| [ProjectionLab Plan Overview](https://projectionlab.com/help/plan-overview) | Enlarged screenshot of chart and adjacent year metrics; documentation | Select a year/month to inspect the underlying numbers; maintain the baseline as a dashed line; switch metric without leaving the workspace |
| [Mercury cash-flow update](https://mercury.com/blog/may-2025-product-updates) | Enlarged Transactions screenshot with chart, filters, sidebar, and table | Calm white surfaces, aligned numerical columns, filters shared by charts and detail table, clear hierarchy |
| [Monarch for couples](https://www.monarch.com/for-couples) | Public couples page and household/collaboration descriptions | Shared goals can coexist with separate accounts; explain collaboration plainly |
| [Voyant timeline](https://support.planwithvoyant.com/hc/en-us/articles/4413034995099-Timeline-and-Events-CA) | Read official event workflow; not visually inspected in a signed-in app | Life events as dated objects that change a plan |

Additional evidence of human design work:
[Linear's timeline design walkthrough](https://www.youtube.com/watch?v=kCQ29IGMnB4)
describes Adrien's design iterations and the engineers' implementation;
[Linear's design process](https://linear.app/method/manage-design-projects) explains
designer/engineer review. [ProjectionLab's founder account](https://cdn.projectionlab.com/about)
describes Kyle Nolan starting the product in 2021.

No paid accounts or private financial sessions were accessed. Public marketing
screenshots validate visual patterns, not the complete usability of each product.

## Competitive implication

ProjectionLab already supports household planning, milestones, scenarios, and
uncertainty. Monarch already combines separate and joint finances and supports
shared goals. Its public FAQ says household members have full visibility into
accounts and transactions. Converge should make disclosure and ownership explicit
and validate personal security alongside household outcomes. This is a proposed
product direction, not a claim that competitors lack every related feature.

## Proposed principal screen

Use a desktop planning workspace with one main task: edit a life plan and see
what changes for each person and the household.

1. Narrow left navigation: Plan, Finances, Goals, Assumptions. A compact couple
   identity selector establishes context without taking over the page.
2. Top row: scenario name, baseline/alternative selector, comparison control,
   currency and horizon. Saving a scenario and jointly approving it are distinct.
3. Three aligned timeline lanes: Partner A, Partner B, Shared. Education or career
   breaks appear as durations; moving or a purchase appears as a dated milestone.
   Shared events show both participants. Allow focus on a single lane or expand
   all three. Visibility filters never change ownership or calculation scope.
4. A chart directly below shares the timeline's time scale and selected date.
   Default to liquid cash and personal reserve thresholds; allow net worth,
   monthly surplus, and goal progress. Show one active scenario band and a
   dashed baseline. Comparing multiple bands needs small multiples, not a tangle.
5. Right inspector opens for an event or selected month. For an event, edit its
   cost, timing, owner, and split. For a month, show each partner's resources,
   shared obligations, transfers, and the reason for a constraint breach.
6. A compact comparison strip answers: what changes, who contributes, whose
   reserve is most exposed, and which goal moves. Every value comes from the
   engine. Explainable deltas lead to the underlying assumptions and cash flows.

The timeline and inspector adapt Linear's time/selection conventions. The chart
and baseline adapt ProjectionLab. Tables and numerical alignment adapt Mercury.
These are interaction references; use original Converge assets and layout details.

## Visual choices to prototype

- Light warm-neutral canvas, near-white panels, charcoal text, fine separators.
- One restrained identity colour per partner, plus a third shared identity colour.
  Reserve danger/success colours for states, not personal identities. Names,
  labels, shapes and line styles carry meaning as well as colour.
- Readable type, tabular numbers, consistent units, clear date labels, controlled
  spacing. Make charts large enough to read and edit.
- Bring details in on selection. Avoid a home screen filled with equal-weight
  statistic cards, decorative gradients, oversized greetings, and persistent
  chat panels that squeeze the actual planning work.
- Dragging an event previews results; releasing commits the local draft, with
  undo. Provide equivalent date fields and keyboard actions. Show an explicit
  calculation state if stochastic results take time; do not animate invented
  intermediate numbers.
- Keep the date selection, identity colours, and metric labels consistent across
  chart, lanes, inspector and comparisons.

## Uncertainty and joint decisions in the interface

Label bands as modelled ranges under the selected assumptions. Distinguish actual
synthetic history from projections with a visible boundary. A 10th-90th percentile
band at each date is not an 80% guarantee that an entire path stays inside it.

Keep three concepts distinct: visibility of information, ownership of resources,
and approval of a shared decision. A partner may share a contribution capacity
without exposing every personal transaction, but calculations using undisclosed
information must communicate their scope. A draft shared event should not acquire
both partners' approval because one person moved it on a chart.

Use the same interaction for conventional and unusual plans: moving together,
buying, parental leave, alternating sabbaticals, two four-day weeks, entrepreneurship,
or supporting relatives. The interface should reveal event dependencies and
trade-offs without needing a new screen for every scenario.

## Review tasks for a first prototype

Check that someone can identify who owns an event, move it to a different date,
see its cash-flow consequences, spot one partner's reserve breach, compare with
the baseline, inspect the driving assumption, and undo the change. Include a
keyboard-only path and readable small-screen summary. These are proposed
acceptance checks; no interface has been implemented in this research pass.
