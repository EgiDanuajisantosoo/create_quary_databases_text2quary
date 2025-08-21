// src/app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || "").replace(/\/+$/, "");

type Role = "system" | "user" | "assistant";
interface ChatMessage { role: Role; content: string }
interface ChatPayload {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  format?: "json" | "text";
  options?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  if (!OLLAMA_BASE) {
    return NextResponse.json(
      { error: "OLLAMA_BASE_URL tidak di-set di environment" },
      { status: 500 }
    );
  }
  let body: ChatPayload;
  try {
    body = (await req.json()) as ChatPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    // Teruskan status & payload apa adanya (Ollama balas JSON)
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
