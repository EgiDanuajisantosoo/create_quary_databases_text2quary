const OLLAMA_BASE  = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "sqlcoder:7b";

async function ollamaGenerate(prompt: string, opts?: { timeoutMs?: number }) {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort("timeout"), timeoutMs);

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "Connection": "close" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { num_predict: 256, temperature: 0 },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama error ${res.status}: ${text.slice(0, 250)}`);
    }

    const data: any = await res.json();
    if (data?.error) throw new Error(`Ollama error: ${data.error}`);

    let out = data?.response ?? data?.text ?? "";

    if (!out) {
      out = await ollamaChatFallback(prompt, { timeoutMs });
    }

    if (!out) throw new Error("Ollama tidak mengembalikan teks.");
    return String(out);
  } finally {
    clearTimeout(id);
  }
}

async function ollamaChatFallback(prompt: string, opts?: { timeoutMs?: number }) {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort("timeout"), timeoutMs);

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "Connection": "close" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: { num_predict: 256, temperature: 0 },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama chat error ${res.status}: ${text.slice(0, 250)}`);
    }

    const data: any = await res.json();
    if (data?.error) throw new Error(`Ollama chat error: ${data.error}`);

    return String(data?.message?.content ?? "");
  } finally {
    clearTimeout(id);
  }
}
