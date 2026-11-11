// Context occupancy of a transcript, used by the ctx hook.
import fs from "node:fs";

// Input + cache tokens of the last assistant turn; only the transcript's tail is read. 0 when unknown.
export function contextTokens(tp) {
  if (!tp || !fs.existsSync(tp)) return 0;
  const fd = fs.openSync(tp, "r");
  const size = fs.fstatSync(fd).size;
  const len = Math.min(size, 512 * 1024);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, size - len);
  fs.closeSync(fd);

  for (const line of buf.toString("utf8").split("\n").reverse()) {
    try {
      const o = JSON.parse(line);
      const u = o.type === "assistant" && o.message?.usage;
      if (!u) continue;
      const n =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0);
      if (n) return n;
    } catch {}
  }
  return 0;
}
