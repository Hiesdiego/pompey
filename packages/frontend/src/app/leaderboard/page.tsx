import { redirect } from "next/navigation";

/** Public predictor rankings have been retired. */
export default function LeaderboardPage() {
  redirect("/");
}
