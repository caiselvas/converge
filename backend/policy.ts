/** Curated evidence snapshot, not a general Swiss eligibility or tax engine. */
export interface SourceRule {
  id: string;
  title: string;
  category: "education" | "insurance" | "housing" | "pension" | "tax";
  jurisdiction: string;
  status: "in_force" | "scheduled" | "proposal" | "guidance";
  effectiveFrom: string | null;
  verifiedOn: string;
  url: string;
  summary: string;
  impact: string;
  calculation: "implemented" | "check_required" | "context_only";
}

const verifiedOn = "2026-11-22";

export const RULES: SourceRule[] = [
  {
    id: "vd-education-independence",
    title: "Vaud study support: independence matters",
    category: "education",
    jurisdiction: "Vaud",
    status: "in_force",
    effectiveFrom: null,
    verifiedOn,
    url: "https://www.vd.ch/formation/aides-financieres-aux-etudes-et-a-la-formation-professionnelle-bourses-ou-prets/informations-principales/questions-frequentes/calcul-montant-et-versement",
    summary:
      "Moving out does not establish independence. A qualifying diploma and two consecutive working years in Vaud are normally required; without a diploma, the guidance specifies four preceding working years.",
    impact:
      "Age 25 changes parental-income treatment only when the independence requirements are satisfied. Parental wealth can still affect grant versus loan. No award is assumed.",
    calculation: "check_required",
  },
  {
    id: "vd-education-reform",
    title: "Vaud support reform: proposed, not budgeted",
    category: "education",
    jurisdiction: "Vaud",
    status: "proposal",
    effectiveFrom: null,
    verifiedOn,
    url: "https://www.vd.ch/actualites/decisions-du-conseil-detat/seance-du-conseil-detat/seance/1032979",
    summary:
      "The cantonal government submitted a study-support reform to parliament in May 2026. An enacted commencement date was not established in this review.",
    impact:
      "Do not apply proposed improvements to grants or independence criteria as current entitlements.",
    calculation: "context_only",
  },
  {
    id: "epfl-tuition",
    title: "EPFL tuition depends on residence category",
    category: "education",
    jurisdiction: "EPFL",
    status: "in_force",
    effectiveFrom: "2025-09-01",
    verifiedOn,
    url: "https://www.epfl.ch/education/studies/en/rules-and-procedures/study-taxes/tuition-fee-other-fees/",
    summary:
      "Since autumn 2025, semester invoices are CHF 780 or CHF 2,240. Swiss nationality, qualifying prior residence and transitional protections affect the category.",
    impact:
      "Confirm the category and invoice before budgeting; years of Swiss residence alone cannot establish the lower fee. CPI adjustment is planned first in 2029.",
    calculation: "check_required",
  },
  {
    id: "epfl-excellence",
    title: "EPFL excellence fellowship is competitive",
    category: "education",
    jurisdiction: "EPFL",
    status: "guidance",
    effectiveFrom: null,
    verifiedOn,
    url: "https://www.epfl.ch/education/master/master-excellence-fellowships/how-to-apply/",
    summary:
      "Selected candidates receive CHF 10,000 per semester for at most four semesters. Existing Master holders and current EPFL Master students are excluded.",
    impact:
      "For 2027 external entry, the paid, validated application is due 15 December 2026. Internal routes differ. Include income only after an award; renewal has performance conditions.",
    calculation: "check_required",
  },
  {
    id: "ch-health-age",
    title: "Health insurance has age-sensitive categories",
    category: "insurance",
    jurisdiction: "Switzerland",
    status: "in_force",
    effectiveFrom: null,
    verifiedOn,
    url: "https://www.bag.admin.ch/en/health-insurance-premiums-and-co-payment",
    summary:
      "Premiums distinguish children, young adults aged 19–25, and adults. Student status can also affect the hospital daily contribution exemption.",
    impact:
      "Requote age-category transitions using Priminfo. A national average or a partner’s premium is not a personal insurance quote.",
    calculation: "check_required",
  },
  {
    id: "ch-health-2027",
    title: "Approved 2027 premiums are available",
    category: "insurance",
    jurisdiction: "Switzerland",
    status: "scheduled",
    effectiveFrom: "2027-01-01",
    verifiedOn,
    url: "https://www.bag.admin.ch/en/health-insurance-comparison-of-premiums",
    summary:
      "FOPH published approved 2027 premium material on 29 September 2026.",
    impact:
      "Use premium year, postcode, insurer, model, deductible, accident cover and age category. Assess cantonal subsidies separately rather than assuming a uniform increase.",
    calculation: "check_required",
  },
  {
    id: "ch-student-avs",
    title: "Study breaks can still require AVS contributions",
    category: "pension",
    jurisdiction: "Switzerland",
    status: "in_force",
    effectiveFrom: null,
    verifiedOn,
    url: "https://www.ahv-iv.ch/p/2.10.f",
    summary:
      "Nonworking students domiciled in Switzerland generally contribute from January after age 20. From January after age 25, assessment uses financial circumstances rather than the student minimum.",
    impact:
      "Check compensation-office assessment, payroll contributions, residence and exemptions. The 2025/2026 student minimum is CHF 530 annually plus possible administration costs.",
    calculation: "check_required",
  },
  {
    id: "ch-3a-catchup",
    title: "Pillar 3a catch-up has income conditions",
    category: "pension",
    jurisdiction: "Switzerland",
    status: "in_force",
    effectiveFrom: "2025-01-01",
    verifiedOn,
    url: "https://faq.bsv.admin.ch/de/integration/37",
    summary:
      "Eligible gaps from 2025 may first be addressed in 2026, within ten years. Eligibility requires AHV-liable income in both relevant years and a full ordinary payment in the purchase year.",
    impact:
      "An entirely unpaid study year cannot automatically be repaired through pillar 3a. Check limits and eligibility before modelling a catch-up or tax deduction.",
    calculation: "check_required",
  },
  {
    id: "ch-imputed-rent-2029",
    title: "Housing tax reform starts in 2029",
    category: "housing",
    jurisdiction: "Switzerland",
    status: "scheduled",
    effectiveFrom: "2029-01-01",
    verifiedOn,
    url: "https://www.admin.ch/fr/newnsb/yGTqBPowRqyVh0zPokW-q",
    summary:
      "The Federal Council set 1 January 2029 for abolition of owner-occupied imputed rent, with related changes to maintenance and interest deductions.",
    impact:
      "Do not remove imputed rent before 2029. The package also removes deductions and introduces a limited first-home interest deduction; it is not a guaranteed tax saving.",
    calculation: "context_only",
  },
  {
    id: "ch-property-ordinance-consultation",
    title: "Housing implementation details remain under consultation",
    category: "tax",
    jurisdiction: "Switzerland",
    status: "proposal",
    effectiveFrom: null,
    verifiedOn,
    url: "https://www.estv.admin.ch/fr/newnsb/cMRcBbv5OK0u",
    summary:
      "A property-cost ordinance consultation opened on 18 November 2026 and runs until 4 March 2027, targeting alignment with the 2029 reform.",
    impact:
      "Keep proposed ordinance details separate from enacted commencement of the housing reform. This MVP does not calculate Swiss property taxes.",
    calculation: "context_only",
  },
];

export interface EducationPerson {
  birthDate: string;
  canton: string;
  /** Self-reported completed working years; not proof of Vaud legal independence. */
  independentYears: number;
  hasQualification: boolean;
  swissResidenceYears: number;
}

export interface EducationCheck {
  ruleId: string;
  title: string;
  status: "check_required" | "potential" | "not_applicable";
  detail: string;
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Expected an ISO date (YYYY-MM-DD).");
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Invalid calendar date.");
  }
  return date;
}

/** Prompts for evidence only: never assigns a scholarship probability or amount. */
export function educationChecks(
  person: EducationPerson,
  startDate: string,
): EducationCheck[] {
  const birth = parseDate(person.birthDate);
  const start = parseDate(startDate);
  if (start < birth) throw new Error("Study start must not precede birth.");
  if (
    ![person.independentYears, person.swissResidenceYears].every(
      (n) => Number.isFinite(n) && n >= 0,
    )
  ) {
    throw new Error(
      "Residence and working years must be finite and nonnegative.",
    );
  }
  const year = start.getUTCFullYear();
  const birthdayPassed =
    start.toISOString().slice(5, 10) >= person.birthDate.slice(5, 10);
  const age = year - birth.getUTCFullYear() - (birthdayPassed ? 0 : 1);
  const vaud = ["VD", "VAUD", "CANTON DE VAUD"].includes(
    person.canton.trim().toUpperCase(),
  );
  const plausibleHistory =
    age >= 18 && person.independentYears >= (person.hasQualification ? 2 : 6);
  const checks: EducationCheck[] = [
    {
      ruleId: "vd-education-independence",
      title: "Check canton and study-support independence",
      status: vaud
        ? plausibleHistory
          ? "potential"
          : "check_required"
        : "not_applicable",
      detail: vaud
        ? `Age ${age} at study start. ${plausibleHistory ? "Reported history merits an OCBE review" : "Reported history does not establish financial independence"}. Verify consecutive work, qualifying income, the final two years in Vaud, diploma type, and status before study. ${age >= 25 ? "Age 25 alone does not remove parental assessment; established independence changes parental-income treatment, while wealth may still matter." : "For younger independent applicants, part of parental resources remains relevant."} Nationality, permit, parents’ finances, eligible course and grant domicile remain unknown; Swiss residence duration alone is insufficient.`
        : "The Vaud-specific independence check does not cover this canton. Confirm the competent scholarship canton; current residence alone may not determine grant domicile.",
    },
    {
      ruleId: "epfl-tuition",
      title: "Confirm institution and tuition category",
      status: "check_required",
      detail:
        "If studying at EPFL, confirm the CHF 780 or CHF 2,240 semester invoice category. Nationality, reason for prior residence and transition protections are unknown; do not infer the category from residence years.",
    },
    {
      ruleId: "epfl-excellence",
      title: "Explore competitive support separately",
      status: "check_required",
      detail:
        "If applying to an EPFL Master, check degree history, academic record, application route and deadline. For 2027 external entry, validate and pay by 15 December 2026. Budget zero fellowship until an award is confirmed.",
    },
    {
      ruleId: "ch-student-avs",
      title: "Review pension contributions during study",
      status: "check_required",
      detail:
        year > birth.getUTCFullYear() + 25
          ? "By this calendar year, nonworking students are past the student-minimum age window. Ask the compensation office for an assessment using assets, pension income and any payroll contributions; no amount is inferred."
          : year > birth.getUTCFullYear() + 20
            ? "Nonworking students domiciled in Switzerland generally owe contributions in this calendar year. Check current rates, payroll credits and exemptions with the compensation office."
            : "Check contribution requirements at the January after the twentieth birthday, and earlier payroll contributions if working. Residence and work status are not established here.",
    },
  ];
  if (vaud)
    checks.push({
      ruleId: "vd-education-reform",
      title: "Keep proposed reform outside the grant budget",
      status: "check_required",
      detail:
        "A May 2026 reform proposal is tracked as context. Verify adoption and commencement before using revised support or independence criteria.",
    });
  return checks;
}
