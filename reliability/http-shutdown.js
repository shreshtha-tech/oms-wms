// Dependency injection keeps termination tests from exiting the test process.
export function drainHttpServer({ server, closeStores, deadlineMs = 30000, onDeadline = () => process.exit(1), onError = () => { process.exitCode = 1; } }) {
  let terminal = false;
  const deadline = setTimeout(() => {
    if (terminal) return;
    terminal = true;
    server.closeAllConnections();
    onDeadline();
  }, deadlineMs);
  deadline.unref();
  server.close(async () => {
    try {
      await closeStores();
      terminal = true;
      clearTimeout(deadline);
    } catch {
      // Keep the deadline armed if cleanup fails or leaves handles alive.
      onError();
    }
  });
  server.closeIdleConnections();
}
