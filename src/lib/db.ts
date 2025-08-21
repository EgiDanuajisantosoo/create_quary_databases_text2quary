import mysql from "mysql2/promise";

let _pool: mysql.Pool | null = null;

function must(name: string) {
  const v = process.env[name];
  if (v === undefined || v === null) throw new Error(`Missing env: ${name}`);
  return v;
}

export function getPool() {
  if (_pool) return _pool;

  const host = must("DB_HOST");
  const user = must("DB_USER");
  const database = must("DB_NAME");
  const password = process.env.DB_PASSWORD ?? "";
  const port = Number(process.env.DB_PORT || 3306);

  _pool = mysql.createPool({
    host,
    user,
    password,
    database,
    port,
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 10_000, // 10s
  });

  return _pool;
}
