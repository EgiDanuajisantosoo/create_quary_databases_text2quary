import "server-only";
import { z } from "zod";
import { getSchema, ALLOWED_TABLES } from "./schema";
import { getPool } from "./db";

/** ===== ENV & KONST ===== */
const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:3b"; // model ringan lebih stabil
const OLLAMA_FORCE_CPU = process.env.OLLAMA_FORCE_CPU === "1";
// const MAX_LIMIT = Number(process.env.TEXT2SQL_MAX_LIMIT || 100);

const ALLOWED_LIST = [...ALLOWED_TABLES] as const;

const SYSTEM_JSON = `Kamu adalah asisten pembuat SQL untuk MySQL.
Gunakan HANYA tabel: ${ALLOWED_LIST.join(", ")}.
Dilarang operasi tulis (INSERT/UPDATE/DELETE/ALTER/DROP/TRUNCATE/CREATE/REPLACE/GRANT/REVOKE).
Format tanggal 'YYYY-MM-DD'. Pakai single quotes untuk string.
Gunakan **kata kunci SQL dalam bahasa Inggris** (SELECT, FROM, WHERE, GROUP BY, ORDER BY, LIMIT).
Balas PERSIS JSON {"sql":"<SATU BARIS SQL>"} — tanpa teks lain.`;

function buildUserJsonPrompt(schemaText: string, question: string) {
  return [
    `Skema:`,
    schemaText,
    ``,
    `Pertanyaan:`,
    question,
    ``,
    `Balas persis JSON: {"sql":"..."} (satu baris SQL).`,
    `dan berikan penjelasan quary yang digunakan.`,
  ].join("\n");
}

/** ===== Helpers: cleaning & guard ===== */
function normalizeSqlOutput(raw: string) {
  let s = String(raw ?? "").trim();
  s = s.replace(/^```sql\s*/i, "").replace(/^```/i, "").replace(/```$/i, "");
  s = s.replace(/^sql\s*:\s*/i, "");
  s = s.replace(/--.*$/gm, "").replace(/#.*$/gm, "");
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  s = s.replace(/;+\s*$/g, "");
  s = s.replace(/"""+/g, '""');
  s = s.replace(/"([^"`\n\r]*)"/g, "'$1'"); // "string" → 'string'
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ===== Tambahkan helper ini di dekat helper lain =====
function syntaxIssues(sql: string): string[] {
  const issues: string[] = [];
  if (/\.\./.test(sql)) issues.push("double-dot '..' ditemukan");
  if (/\bfrom\s*(,|\)|$)/i.test(sql)) issues.push("FROM tanpa nama tabel");
  if (/\bjoin\s*(,|\)|$)/i.test(sql)) issues.push("JOIN tanpa nama tabel");
  if (/[,]\s*[,]/.test(sql)) issues.push("koma ganda ',,'");
  if (/\(\s*\)/.test(sql)) issues.push("kurung kosong '()'");
  // jika ada titik di awal/akhir identifier: "schema." atau ".table"
  if (/\bfrom\s+\./i.test(sql) || /\bjoin\s+\./i.test(sql)) issues.push("identifier dimulai dengan '.'");
  if (/\.\s+(as\b|on\b|where\b|group\b|order\b|limit\b)/i.test(sql)) issues.push("identifier diakhiri dengan '.'");
  return issues;
}

function autoFixOrdering(sql: string) {
  let s = sql;

  s = s.replace(/\b(?!(order|group)\b)([a-zA-Z_]+)\s+by\b/gi, " ORDER BY");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}


function buildSyntaxRepairPrompt(schemaText: string, badSql: string, issues: string[]) {
  return [
    `SQL berikut memiliki masalah sintaks: ${issues.join("; ")}.`,
    `Perbaiki menjadi SQL MySQL **valid** satu baris.`,
    `Gunakan **HANYA** tabel ini: ${ALLOWED_LIST.join(", ")}.`,
    `JANGAN tambahkan penjelasan. Balas persis JSON: {"sql":"<SATU BARIS SQL>"}.`,
    "",
    "Skema:",
    schemaText,
    "",
    "SQL salah:",
    badSql,
  ].join("\n");
}


function validateQuotes(sql: string) {
  const single = (sql.match(/'/g) || []).length;
  const backtick = (sql.match(/`/g) || []).length;
  if (single % 2 !== 0) throw new Error("SQL memiliki tanda kutip tunggal yang tidak seimbang.");
  if (backtick % 2 !== 0) throw new Error("SQL memiliki backtick yang tidak seimbang.");
}

function ensureLimit(sql: string, max = 100) {
  if (/\blimit\s+\d+/i.test(sql)) return sql;
  if (/^(show|describe)\b/i.test(sql)) return sql;
  return `${sql} LIMIT ${max}`;
}

/** Ambil nama tabel setelah FROM / JOIN / UPDATE / INTO */
function extractTableNames(sql: string) {
  const s = sql.replace(/--.*$/gm, "").replace(/#.*$/gm, "").replace(/\s+/g, " ");
  const names: string[] = [];
  const re =
    /\b(from|join|update|into)\s+((?:`[^`]+`|[a-zA-Z0-9_]+)(?:\.(?:`[^`]+`|[a-zA-Z0-9_]+))?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) names.push(m[2].trim().replace(/`/g, "").toLowerCase());
  return names;
}

/** Whitelist: dukung schema.table */
const ALLOWED = new Set(ALLOWED_LIST.map((t) => t.toLowerCase()));
const DB_SCHEMA = process.env.DB_NAME?.toLowerCase();
if (DB_SCHEMA) for (const t of Array.from(ALLOWED)) ALLOWED.add(`${DB_SCHEMA}.${t}`);

function getUnknownTables(sql: string) {
  const names = extractTableNames(sql);
  const unknown: string[] = [];
  for (const n of names) {
    if (ALLOWED.has(n)) continue;
    const short = n.includes(".") ? n.split(".").pop()! : n;
    if (!ALLOWED.has(short)) unknown.push(n);
  }
  return unknown;
}

/** Sinonim umum → tabel asli (opsional) */
const UNKNOWN_TABLE_MAP: Record<string, string> = {
  orders: "transaksis",
  order: "transaksis",
  sales: "transaksis",
  transactions: "transaksis",
  order_items: "detail_transaksis",
  order_item: "detail_transaksis",
  transaction_details: "detail_transaksis",
  items: "detail_transaksis",
  products: "barang",
  product: "barang",
  goods: "barang",
  barangs: "barang",
  transaksi: "transaksis",
  detail_transaksi: "detail_transaksis",
  users_table: "users",
  customers: "users",
  accounts: "users",
};

function rewriteTables(sql: string) {
  let out = sql;
  for (const [from, to] of Object.entries(UNKNOWN_TABLE_MAP)) {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const withSchema = DB_SCHEMA ? `${DB_SCHEMA}\\.${esc}` : null;
    if (withSchema) {
      out = out.replace(new RegExp(`(?<![a-z0-9_])\`?${withSchema}\`?(?![a-z0-9_])`, "gi"), to);
    }
    out = out.replace(new RegExp(`(?<![a-z0-9_])\`?${esc}\`?(?![a-z0-9_])`, "gi"), to);
  }
  return out;
}

/** ===== Ollama /api/chat JSON-mode + retry ===== */
type ChatJsonOptions = { timeoutMs?: number; tries?: number };

async function ollamaChatJson(system: string, user: string, opts: ChatJsonOptions = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const tries = opts.tries ?? 3;
  let lastErr: any;

  for (let attempt = 1; attempt <= tries; attempt++) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort("timeout"), timeoutMs);
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "Connection": "close" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          stream: false,
          format: "json",           
          keep_alive: "30m",
          options: {
            num_predict: 128,
            temperature: 0,
            top_p: 0.9,
            repeat_penalty: 1.05,
            ...(OLLAMA_FORCE_CPU ? { num_gpu: 0 } : {}),
          },
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Ollama chat error ${res.status}: ${text.slice(0, 200)}`);
      }

      const data: any = await res.json();
      if (data?.error) throw new Error(`Ollama chat error: ${data.error}`);

      const content = String(data?.message?.content ?? "");
      if (!content) throw new Error("Ollama tidak mengembalikan teks.");

      // parse JSON {"sql":"..."}
      let parsed: any = null;
      try {
        parsed = JSON.parse(content);
      } catch {
        const m = content.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }
      if (!parsed || typeof parsed.sql !== "string" || !parsed.sql.trim()) {
        throw new Error("Balasan bukan JSON {\"sql\":\"...\"} yang valid.");
      }
      return parsed.sql as string;
    } catch (e: any) {
      lastErr = e;
      if (attempt < tries) {
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(id);
    }
  }

  throw lastErr;
}

/** ===== API-facing ===== */
export const querySchema = z.object({
  question: z.string().min(3),
  execute: z.boolean().default(false),
});

export async function makeSql(question: string) {
  const schemaText = await getSchema(ALLOWED_LIST);

  // 1) minta JSON {"sql":"..."} dari model
  let sql = await ollamaChatJson(
    SYSTEM_JSON,
    buildUserJsonPrompt(schemaText, question),
    { timeoutMs: 90_000, tries: 3 }
  );

  // 2) normalisasi & guard
  sql = normalizeSqlOutput(sql);
  sql = sql.split("\n")[0].trim(); // satu baris
  sql = rewriteTables(sql);
  sql = autoFixOrdering(sql);
  validateQuotes(sql);
  // sql = ensureLimit(sql, MAX_LIMIT);

  // 2a) cek masalah sintaks sederhana (mis. '..')
let issues = syntaxIssues(sql);
for (let attempt = 0; attempt < 2 && issues.length > 0; attempt++) {
  const repaired = await ollamaChatJson(
    SYSTEM_JSON,
    buildSyntaxRepairPrompt(schemaText, sql, issues),
    { timeoutMs: 60_000, tries: 3 }
  );
  let fixed = normalizeSqlOutput(repaired);
  fixed = fixed.split("\n")[0].trim();
  fixed = rewriteTables(fixed);
  // fixed = ensureLimit(fixed, MAX_LIMIT);
  validateQuotes(fixed);
  sql = fixed;
  issues = syntaxIssues(sql);
}
if (issues.length > 0) {
  throw new Error(`SQL masih bermasalah: ${issues.join("; ")}. Hasil: ${sql}`);
}


  let unknown = getUnknownTables(sql);
  for (let attempt = 0; attempt < 2 && unknown.length > 0; attempt++) {
    const repairUser = [
      `SQL berikut menggunakan tabel di luar whitelist: ${unknown.join(", ")}`,
      `Perbaiki agar HANYA pakai tabel: ${ALLOWED_LIST.join(", ")}`,
      `Balas persis JSON: {"sql":"<SATU BARIS SQL>"} tanpa teks lain.`,
      ``,
      `Skema:`,
      schemaText,
      ``,
      `SQL salah:`,
      sql,
    ].join("\n");

    let fixed = await ollamaChatJson(SYSTEM_JSON, repairUser, { timeoutMs: 60_000, tries: 3 });
    fixed = normalizeSqlOutput(fixed);
    // fixed = ensureLimit(fixed, MAX_LIMIT);
    validateQuotes(fixed);
    sql = rewriteTables(fixed);
    unknown = getUnknownTables(sql);
  }

  if (unknown.length > 0) {
    throw new Error(`Query keluar dari whitelist. Tabel tidak dikenali/diizinkan: ${unknown.join(", ")}`);
  }

  return sql;
}

export async function explainSql(sql: string) {
  const pool = getPool();
  const [rows] = await pool.query({ sql: "EXPLAIN " + sql, timeout: 10_000 });
  return rows;
}

export async function runSql(sql: string) {
  const pool = getPool();
  const [rows] = await pool.query({ sql, timeout: 15_000 });
  return rows as Record<string, any>[];
}
