import { getPool } from "./db";

export const ALLOWED_TABLES = [
  "users",
  "transaksis",
  "detail_transaksis",
  "barang",
] as const;

const q = (id: string) => "`" + id.replace(/`/g, "``") + "`";

export async function getSchema(
  allowed: readonly string[] = ALLOWED_TABLES 
): Promise<string> {
  const pool = getPool();
  const useTables = (allowed?.length ? allowed : ALLOWED_TABLES).filter((t) =>
    (ALLOWED_TABLES as readonly string[]).includes(t as any)
  );

  const parts: string[] = [];
  for (const t of useTables) {
    const [cols] = await pool.query(`SHOW COLUMNS FROM ${q(t)}`);
    const colStr = (cols as any[])
      .map((c: any) => {
        const notNull = c.Null === "NO" ? " NOT NULL" : "";
        const def =
          c.Default !== null && c.Default !== undefined
            ? ` DEFAULT ${JSON.stringify(c.Default)}`
            : "";
        return `${c.Field} ${c.Type}${notNull}${def}`;
      })
      .join(", ");
    parts.push(`Table ${t}: ${colStr}`);
  }
  return parts.join("\n");
}
