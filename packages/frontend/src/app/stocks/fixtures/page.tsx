import { redirect } from "next/navigation";

export default function LegacyStockFixturesPage() {
  redirect("/fixtures?league=stocks");
}
