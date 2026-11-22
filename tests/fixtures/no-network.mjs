// Preloaded with `node --import` by src/entrypoint.test.ts: every fetch in the
// spawned server rejects, so starting the real entrypoint reaches no network.
globalThis.fetch = async (input) => {
  throw new Error(`network is disabled in this test (${String(input)})`);
};
