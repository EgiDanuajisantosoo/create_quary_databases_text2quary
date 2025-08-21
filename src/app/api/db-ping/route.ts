import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const pool = getPool();
    const [rows] = await pool.query("SELECT DATABASE() AS db, NOW() AS now");
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
