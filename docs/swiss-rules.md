# Swiss rule evidence for the first planning workspace

Verified 22 November 2026. This is a bounded, manually curated snapshot for the
Swiss-couple demo. `backend/policy.ts` distinguishes current guidance, scheduled
law and proposals. No scholarship award, premium quote or Swiss tax liability
is calculated from these records. A check marked `potential` means the reported
history warrants a review; it does not mean eligibility has been established.

## Education changes with age and history

[Vaud OCBE's current FAQ](https://www.vd.ch/formation/aides-financieres-aux-etudes-et-a-la-formation-professionnelle-bourses-ou-prets/informations-principales/questions-frequentes/calcul-montant-et-versement)
requires more than a separate home: a professional qualification and consecutive
qualifying work in Vaud, or a longer route without a qualification. Independence
must precede study. The FAQ describes a CHF 21,720 annual income threshold;
this version deliberately does not automate that test because the form does
not capture documented qualifying income, dates, canton-specific work or
assimilated periods.

There is no universal age-25 scholarship expiry. Age 25 changes parental-income
treatment conditional on independence. Parental wealth can affect grant versus
loan. The FAQ labels its two groups with overlapping wording at age 25;
[Federal Supreme Court discussion of LAEF article 28](https://www.bger.ch/ext/eurospider/live/fr/php/aza/http/index.php?highlight_docid=aza%3A%2F%2F24-08-2021-2C_644-2020&lang=fr&type=show_document&zoom=)
supports the attained-age-25 threshold. The helper uses attained age on study
start only to prompt a review; application-date treatment still needs OCBE
confirmation. Nationality, permits, parents' domicile and means, course
recognition and competent grant canton are missing inputs.

The [May 2026 cantonal government submission](https://www.vd.ch/actualites/decisions-du-conseil-detat/seance-du-conseil-detat/seance/1032979)
is evidence of a proposal, not proof of enacted benefits. The related
[government announcement](https://www.vd.ch/typo3temp/assets/pdfs/une-reforme-de-la-loi-pour-renforcer-le-soutien-financier-aux-personnes-en-formation.pdf)
includes reducing the no-diploma working-history route from six to four years,
updated expense allowances and a proposed CHF 6,000 earned-income disregard.
No commencement was established; none is applied. Recheck parliament and the
consolidated law before updating the implementation.

[EPFL's fee guidance](https://www.epfl.ch/education/studies/en/rules-and-procedures/study-taxes/tuition-fee-other-fees/)
sets current semester invoices at CHF 780 or CHF 2,240. Nationality, prior
residence purpose and transition provisions matter. The catalogue's
2025-09-01 date normalizes “autumn semester 2025” for display; it is not a claim
about the exact statutory commencement day. Verify the actual invoice. Do not
extend today's fees indefinitely: the first CPI adjustment is described for 2029.

[EPFL excellence fellowship applications](https://www.epfl.ch/education/master/master-excellence-fellowships/how-to-apply/)
are competitive, not an expected salary replacement. For 2027 external entry,
the application must be paid and validated by 15 December 2026; internal routes
have different deadlines. An award is CHF 10,000 per semester, at most four
semesters, and renewal requires academic performance. Existing Master holders
and current EPFL Master students are excluded. No success probability is inferred.

## Other consequences of studying, reducing work or buying

- [FOPH premium guidance](https://www.bag.admin.ch/en/health-insurance-premiums-and-co-payment)
  distinguishes age categories and student hospital-contribution exceptions.
  The helper does not fabricate an individual quote.
- [Approved 2027 premiums](https://www.bag.admin.ch/en/health-insurance-comparison-of-premiums)
  were published in September 2026. Match postcode, premium year, model,
  deductible, accident cover and insurer, then check cantonal subsidies.
- [Official student AVS information](https://www.ahv-iv.ch/p/2.10.f)
  warns against contribution gaps. Nonworking students generally start paying
  in January after age 20; after the year they turn 25, contributions depend
  on financial circumstances. The CHF 530 minimum is a dated 2025/2026 figure,
  not an assumed perpetual cost. Payroll credits, exemptions and administration
  costs need confirmation.
- [Federal social-insurance pillar 3a FAQ](https://faq.bsv.admin.ch/de/integration/37)
  explains catch-up from 2026 for eligible gaps from 2025. AHV-liable income in
  both years and the current ordinary maximum payment are prerequisites.
  A year without eligible earnings does not automatically create a repairable gap.
- [Federal Council's housing decision](https://www.admin.ch/fr/newnsb/yGTqBPowRqyVh0zPokW-q)
  schedules imputed-rent abolition for 1 January 2029 alongside deduction
  changes. This is not simply removal of one tax expense. Current rules remain
  relevant before then; the MVP leaves the tax effect unquantified.
- [FTA's 18 November 2026 consultation](https://www.estv.admin.ch/fr/newnsb/cMRcBbv5OK0u)
  concerns property-cost ordinance details and closes 4 March 2027. Its proposed
  provisions are distinct from the already scheduled reform commencement.

## Implementation boundary and update policy

All catalogue calculations are `check_required` or `context_only`. None silently
adds a grant, premium saving or tax saving to cash flow. The education helper
validates calendar dates and nonnegative finite history inputs. It computes age
on study start and calendar-year AVS checkpoints, then returns evidence requests.
Its history threshold is a coarse screen: “independentYears” does not prove
consecutive qualifying work or location. A non-Vaud result means only the
Vaud-specific check is inapplicable; it does not mean no support exists.

Before promoting any item to `implemented`, collect its required inputs, encode
effective intervals and exceptions, verify representative boundary cases against
the competent authority and distinguish official amounts from editable scenario
assumptions. Recheck the snapshot after an announced law change, before a live
financial decision, and when the demo's premium or academic year changes.
