// Schedule the next read only after the previous read settles.
export function serialPoll(read: () => Promise<void>, intervalMs: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    try { await read(); }
    catch { /* The next read may recover; the caller owns error presentation. */ }
    finally { if (!stopped) timer = setTimeout(() => void run(), intervalMs); }
  };
  void run();
  return () => { stopped = true; clearTimeout(timer); };
}
