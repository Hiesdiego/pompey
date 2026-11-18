import { redirect } from "next/navigation";

export default function LegacyStockStandingsPage() {
  redirect("/standings?league=stocks");
}
