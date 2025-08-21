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
  try {
    const body = await req.json();
    const { question, execute } = querySchema.parse(body);

    const sql = await makeSql(question);
    lastSql = sql;

    let plan;
    try {
      plan = await explainSql(sql);
    } catch (ex: any) {
      return NextResponse.json(
        { error: ex?.message || "Explain error", sql },
        { status: 400 }
      );
    }

    if (!execute) return NextResponse.json({ sql, plan });

    try {
      const rows = await runSql(sql);
      return NextResponse.json({ sql, plan, rows });
    } catch (ex: any) {
      return NextResponse.json(
        { error: ex?.message || "Run error", sql, plan },
        { status: 400 }
      );
    }
  } catch (e: any) {
    console.error("[/api/text-to-sql] error after", Date.now() - t0, "ms:", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error", sql: lastSql },
      { status: 400 }
    );
  }
}

