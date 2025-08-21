"use client";
import { useState } from "react";

export default function Home() {
  const [q, setQ] = useState("tampilkan 5 barang terlaris Juli 2025");
  const [execute, setExecute] = useState(false);
  const [resp, setResp] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setResp(null);
    try {
      const r = await fetch("/api/text-to-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, execute }),
      });
      const j = await r.json();
      setResp(j);
    } catch (e: any) {
      setResp({ error: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 800, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>Text → SQL (Ollama)</h1>
      <textarea
        value={q}
        onChange={(e) => setQ(e.target.value)}
        rows={4}
        style={{ width: "100%", padding: 12 }}
      />
      <label style={{ display: "block", margin: "8px 0" }}>
        <input type="checkbox" checked={execute} onChange={e => setExecute(e.target.checked)} /> Eksekusi ke DB
      </label>
      <button onClick={submit} disabled={loading} style={{ padding: "8px 16px" }}>
        {loading ? "Memproses..." : "Kirim"}
      </button>

      <pre style={{ background: "#111", color: "#0f0", padding: 16, marginTop: 16, overflow: "auto" }}>
        {resp ? JSON.stringify(resp, null, 2) : "{}"}
      </pre>
    </main>
  );
}
