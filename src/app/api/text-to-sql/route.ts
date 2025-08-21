// src/app/api/text-to-sql/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makeSql, explainSql, runSql, querySchema } from "@/lib/text2sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST { question, execute }" });
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  let lastSql: string | undefined;

  // Matikan di production bila tidak ada OLLAMA_BASE_URL
  if (!process.env.OLLAMA_BASE_URL) {
    return NextResponse.json(
      { error: "Text2SQL dimatikan di production (OLLAMA_BASE_URL tidak di-set)" },
      { status: 501 }
    );
  }

  try {
    const body = await req.json();
    const { question, execute } = querySchema.parse(body);

    const sql = await makeSql(question);
    lastSql = sql;

    let plan;
    try {
      plan = await explainSql(sql);
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      return NextResponse.json({ error: message, sql }, { status: 400 });
    }

    if (!execute) return NextResponse.json({ sql, plan });

    try {
      const rows = await runSql(sql);
      return NextResponse.json({ sql, plan, rows });
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      return NextResponse.json({ error: message, sql, plan }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/text-to-sql] error after", Date.now() - t0, "ms:", message);
    return NextResponse.json({ error: message, sql: lastSql }, { status: 400 });
  }
}
