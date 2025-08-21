// src/app/api/ollama-ping/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const base = (process.env.OLLAMA_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    return NextResponse.json(
      { ok: false, error: "OLLAMA_BASE_URL tidak di-set (fitur dimatikan di production)" },
      { status: 501 }
    );
  }

  try {
    const res = await fetch(`${base}/api/tags`);
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
