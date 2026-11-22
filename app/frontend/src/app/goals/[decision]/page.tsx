import { DecisionPlanner } from "@/components/decisions/DecisionPlanner";
import { DECISION_IDS } from "@/components/decisions/ids";

export function generateStaticParams() {
  return DECISION_IDS.map((decision) => ({ decision }));
}

export default async function DecisionPage({ params }: PageProps<"/goals/[decision]">) {
  const { decision } = await params;
  return <DecisionPlanner id={decision} />;
}
