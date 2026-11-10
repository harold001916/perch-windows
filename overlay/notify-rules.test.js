const test = require("node:test");
const assert = require("node:assert");
const { Notifier, mergeConfig } = require("./notify-rules");

function setup(config = {}, focused = false) {
  let t = 1_000_000;
  const shown = [];
  const n = new Notifier({ now: () => t, getConfig: () => config, isTerminalFocused: async () => focused, show: (x) => shown.push(x) });
  return { n, shown, tick: (ms) => (t += ms) };
}
const s = (state, extra = {}) => ({ id: "a", name: "Demo", state, activity: null, ...extra });

test("no notification for the connect snapshot or a session first seen mid-way", async () => {
  const { n, shown } = setup();
  n.snapshot([s("needs_permission")]);
  assert.equal(await n.update(s("needs_permission")), null);
  assert.equal(await n.update({ ...s("needs_input"), id: "new" }), null); // never seen before
  assert.equal(shown.length, 0);
});

test("permission, question and error notify with the activity as body", async () => {
  const { n, shown, tick } = setup();
  n.snapshot([s("working")]);
  await n.update(s("needs_permission", { activity: "Run npm test?" }));
  tick(6000);
  await n.update(s("working"));
  await n.update(s("needs_input"));
  tick(6000);
  await n.update(s("error", { activity: "boom" }));
  assert.deepEqual(shown.map((x) => x.body), ["Run npm test?", "Esperando tu respuesta", "boom"]);
});

test("done notifies only after a long enough turn", async () => {
  const { n, shown, tick } = setup({ doneMinSeconds: 10 });
  n.snapshot([s("idle")]);
  await n.update(s("working")); tick(3000); await n.update(s("done"));
  assert.equal(shown.length, 0); // 3s turn: skipped
  await n.update(s("working")); tick(30_000); await n.update(s("done"));
  assert.equal(shown.length, 1);
  assert.match(shown[0].title, /terminó/);
});

test("compacting counts as part of the turn", async () => {
  const { n, shown, tick } = setup({ doneMinSeconds: 5 });
  n.snapshot([s("idle")]);
  await n.update(s("working")); tick(4000); await n.update(s("compacting")); tick(4000); await n.update(s("done"));
  assert.equal(shown.length, 1);
});

test("same session and kind is deduplicated within 5s", async () => {
  const { n, shown, tick } = setup();
  n.snapshot([s("working")]);
  await n.update(s("needs_permission")); await n.update(s("working")); tick(1000); await n.update(s("needs_permission"));
  assert.equal(shown.length, 1);
  tick(6000); await n.update(s("working")); await n.update(s("needs_permission"));
  assert.equal(shown.length, 2);
});

test("disabled, done off and focused-terminal rules", async () => {
  let r = setup({ enabled: false });
  r.n.snapshot([s("working")]); await r.n.update(s("needs_permission"));
  assert.equal(r.shown.length, 0);

  r = setup({ done: false, doneMinSeconds: 0 });
  r.n.snapshot([s("working")]); await r.n.update(s("done"));
  assert.equal(r.shown.length, 0);

  r = setup({}, true); // a terminal is in front
  r.n.snapshot([s("working")]); await r.n.update(s("needs_permission"));
  assert.equal(r.shown.length, 0);
  r = setup({ onlyWhenUnfocused: false }, true);
  r.n.snapshot([s("working")]); await r.n.update(s("needs_permission"));
  assert.equal(r.shown.length, 1);
});

test("config tolerates junk", () => {
  assert.deepEqual(mergeConfig(null), { enabled: true, done: true, doneMinSeconds: 10, onlyWhenUnfocused: true });
  assert.equal(mergeConfig({ doneMinSeconds: "x" }).doneMinSeconds, 10);
  assert.equal(mergeConfig({ doneMinSeconds: 0 }).doneMinSeconds, 0);
});
