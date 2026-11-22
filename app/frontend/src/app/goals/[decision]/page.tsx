import { Suspense } from "react";
import { DecisionPlanner } from "@/components/decisions/DecisionPlanner";
import { DECISION_IDS } from "@/components/decisions/ids";

export function generateStaticParams() {
  return DECISION_IDS.map((decision) => ({ decision }));
}

async function PlannerRoute({ params }: PageProps<"/goals/[decision]">) {
  const { decision } = await params;
  return <DecisionPlanner id={decision} />;
}

export default function DecisionPage(props: PageProps<"/goals/[decision]">) {
  return <Suspense><PlannerRoute {...props} /></Suspense>;
}
