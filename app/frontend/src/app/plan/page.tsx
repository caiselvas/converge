import { redirect } from "next/navigation";

// The voice branch called the overview "/plan"; keep its links working.
export default function PlanRedirect() {
  redirect("/");
}
