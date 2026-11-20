import { TICKR_TEAMS } from "@tickr/shared/teams";
import { CUP_TEAMS } from "@/lib/cup";
import { backendUrl, imageDataUrl, logoDataUrl } from "./_shared";

export function cupCmcId(id: number): number | undefined {
  const extras: Record<number, number> = { 32: 36341, 33: 33251, 38: 32782, 49: 27750, 60: 34466 };
  const symbol = CUP_TEAMS.find(t => t.teamId === id)?.symbol;
  return extras[id] ?? TICKR_TEAMS.find(t => t.symbol === (symbol === "TRON" ? "TRX" : symbol === "PENGUIN" ? "PENGU" : symbol))?.cmcId;
}
type DirectoryTeam = { teamId: number; imageUrl: string | null };

async function cupDirectory(): Promise<DirectoryTeam[]> {
  try {
    const response = await fetch(`${backendUrl()}/api/target-teams`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const teams: unknown = await response.json();
    return Array.isArray(teams) ? teams as DirectoryTeam[] : [];
  } catch { return []; }
}

export async function cupLogos(teamIds: number[]): Promise<(string | null)[]> {
  let directory = teamIds.some(id => cupCmcId(id) === undefined) ? cupDirectory() : null;
  const getDirectory = () => directory ??= cupDirectory();
  return Promise.all(teamIds.map(async id => {
    const cmcLogo = await logoDataUrl(cupCmcId(id));
    if (cmcLogo) return cmcLogo;
    const imageUrl = (await getDirectory()).find(team => team.teamId === 1000 + id)?.imageUrl;
    if (imageUrl) {
      const directoryLogo = await imageDataUrl(imageUrl);
      if (directoryLogo) return directoryLogo;
    }
    const symbol = CUP_TEAMS.find(team => team.teamId === id)?.symbol;
    const iconSymbol = symbol === "TRON" ? "trx" : symbol === "PENGUIN" ? "pengu" : symbol?.toLowerCase();
    return iconSymbol ? imageDataUrl(`https://assets.coincap.io/assets/icons/${iconSymbol}@2x.png`) : null;
  }));
}
