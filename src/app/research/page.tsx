import { cookies } from "next/headers";
import { config, sessionFromCookie } from "@/lib/research/server.mjs";
import Workbench from "./Workbench";
import Login from "./Login";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function ResearchPage() {
  try {
    const cfg = config();
    const jar = await cookies();
    if (sessionFromCookie(jar.toString(), cfg.secret)) return <Workbench/>;
    return <Login configured/>;
  } catch { return <Login configured={false}/>; }
}
