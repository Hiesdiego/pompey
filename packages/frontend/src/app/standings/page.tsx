/**
 * Standings page — the complete league table (all 20 teams).
 *
 * Ordered by the backend: points > goal difference > goals scored >
 * games won > fewer games lost.
 */

"use client";

import { useEffect, useState } from "react";
import { Table2 } from "lucide-react";
import { api, type ApiTableRow } from "../../lib/api";
import { SEASON_DISPLAY_NAME } from "../../lib/contracts";
import { LeagueTable, LeagueTableSkeleton } from "../../components/LeagueTable";
import { SectionTitle, ErrorState } from "../../components/States";

export default function StandingsPage() {
  const [table, setTable] = useState<ApiTableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .table()
      .then((t) => {
        if (alive) setTable(t);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (!table) {
    return (
      <div>
        <div className="skeleton mb-4 h-7 w-52 rounded-lg" aria-hidden />
        <div className="skeleton mb-6 h-4 w-80 max-w-full rounded-md" aria-hidden />
        <LeagueTableSkeleton rows={20} />
      </div>
    );
  }

  return (
    <div>
      <SectionTitle title="League standings" />
      <p className="mb-6 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Table2 className="h-4 w-4 text-[#2E7CF6]" />
        {SEASON_DISPLAY_NAME} · ordered by points, then goal difference, goals scored, wins, fewest losses
      </p>

      {table.length === 0 ? (
        <p className="glass rounded-2xl p-6 text-center text-sm text-zinc-500 dark:text-zinc-500">
          No results yet — the table fills in as fixtures settle.
        </p>
      ) : (
        <LeagueTable rows={table} />
      )}
    </div>
  );
}
