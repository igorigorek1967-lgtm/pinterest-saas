import { NextRequest, NextResponse } from "next/server";
import { BACKUP_LIMIT, exportBackup, restoreBackup, logout, bodyJson, config, cookieValue, importObservations, login, queryPinmetrica, readState, requireOwner, ResearchError, sameOrigin, saveBrief, saveProxy } from "@/lib/research/server.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
type Context = { params: Promise<{ action: string }> };
function failure(error: unknown) {
  if (error instanceof ResearchError) return json({ error: error.message }, error.status);
  return json({ error: "Не удалось выполнить операцию. Сохранённые данные не удалены." }, 500);
}
export async function GET(request: NextRequest, context: Context) {
  try {
    requireOwner(request);
    const { action } = await context.params;
    if (action === "backup") return json(exportBackup());
    if (action !== "state") return json({ error: "Раздел не найден." }, 404);
    return json({ ...readState(), sourceConfigured: !!process.env.PINMETRICA_API_KEY });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const { action } = await context.params;
    const cfg = action === "login" ? config() : requireOwner(request);
    sameOrigin(request, cfg);
    const input = await bodyJson(request, action === "restore" ? BACKUP_LIMIT : undefined);
    if (action === "login") {
      const token = login(input.password, cfg);
      const response = json({ ok: true }); response.headers.set("Set-Cookie", cookieValue(token, cfg.secure)); return response;
    }
    if (action === "logout") { logout(request.headers.get("cookie")); const response = json({ ok: true }); response.headers.set("Set-Cookie", cookieValue("", cfg.secure, true)); return response; }
    if (action === "restore") return json(restoreBackup(input));
    if (action === "import") return json(importObservations(input.observations, input.allowRelated === true));
    if (action === "brief") return json(saveBrief(input.observation));
    if (action === "proxy") return json(saveProxy(input.proxy));
    if (action === "query") return json(await queryPinmetrica(input));
    return json({ error: "Раздел не найден." }, 404);
  } catch (error) { return failure(error); }
}
