import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const base = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
    const res = await fetch(`${base}/api/tags`);
    const tags = await res.json();
    return NextResponse.json({ ok: true, base, tags });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
