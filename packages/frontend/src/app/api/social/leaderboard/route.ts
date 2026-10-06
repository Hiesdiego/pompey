/** Public predictor rankings have been retired; use the owner-only /api/social/rank endpoint. */
export async function GET() {
  return Response.json({ error: "not_found" }, { status: 404 });
}
