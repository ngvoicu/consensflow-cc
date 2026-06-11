// Shared stdin reader for the hook scripts (hooks receive their event payload as JSON on stdin).
export async function readStdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
