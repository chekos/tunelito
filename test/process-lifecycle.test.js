import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createShutdownHandler, ownChild, OWNED_PROCESS_OPTIONS, stopOwnedChild } from "../src/process-lifecycle.js";

test("shutdown waits for output drain and preserves termination details", async () => {
  const calls = [];
  let flush;
  const handler = createShutdownHandler({
    cleanup: async () => [{ status: "fulfilled" }],
    failure: (...args) => calls.push(["error", ...args]),
    stopped: (summary) => calls.push(["stopped", summary]),
    restore: () => calls.push(["restore"]),
    drain: () => new Promise((resolve) => { flush = resolve; }),
    exit: (code) => calls.push(["exit", code]),
    timeoutMs: 1000,
  });
  const shutdown = handler("SIGINT");
  await new Promise(setImmediate);
  assert.equal(calls.some(([type]) => type === "exit"), false);
  assert.deepEqual(calls.find(([type]) => type === "stopped")[1], { signal: "SIGINT", exitCode: 130, cleanup: "complete" });
  flush();
  await shutdown;
  assert.deepEqual(calls.at(-1), ["exit", 130]);
  assert.equal(calls.filter(([type]) => type === "error").length, 1);
});

test("a second signal forces owned work down immediately during stalled cleanup", async () => {
  const calls = [];
  const handler = createShutdownHandler({
    cleanup: () => new Promise(() => {}),
    force: () => calls.push("force"), restore: () => calls.push("restore"),
    failure: (reason) => calls.push(reason), stopped: () => calls.push("stopped"), drain: async () => {},
    exit: (code) => calls.push(code), timeoutMs: 1000,
  });
  void handler("SIGINT");
  await handler("SIGINT");
  assert.deepEqual(calls, ["force", "restore", "CANCELLED", 130]);
});

for (const stall of ["cleanup", "drain"]) {
  test(`shutdown deadline bounds stalled ${stall} and emits only one machine failure`, async () => {
    const errors = [];
    let exited;
    const done = new Promise((resolve) => { exited = resolve; });
    const handler = createShutdownHandler({
      cleanup: () => stall === "cleanup" ? new Promise(() => {}) : Promise.resolve([]),
      stopped: () => {}, failure: (reason) => errors.push(reason),
      force: () => {}, restore: () => {},
      drain: () => new Promise(() => {}), exit: exited, timeoutMs: 20,
    });
    void handler("SIGTERM");
    assert.equal(await done, 143);
    assert.deepEqual(errors, [stall === "cleanup" ? "SHUTDOWN_TIMEOUT" : "CANCELLED"]);
  });
}

test("cleanup errors are explicit and never reported as confirmed stopped", async () => {
  const errors = [], summaries = [];
  await createShutdownHandler({ cleanup: async () => [{ status: "rejected", reason: new Error("stalled") }],
    stopped: (summary) => summaries.push(summary), failure: (reason) => errors.push(reason),
    drain: async () => {}, exit: () => {},
  })("SIGHUP");
  assert.deepEqual(errors, ["CLEANUP_FAILED"]);
  assert.equal(summaries[0].cleanup, "incomplete");
});

test("owned child escalates a stalled SIGTERM and requires an exit confirmation", async () => {
  const child = new EventEmitter();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGKILL") queueMicrotask(() => child.emit("exit", null, signal));
  };
  await stopOwnedChild(child, { graceMs: 10, killMs: 10 });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.listenerCount("exit"), 0);
  child.kill = () => {};
  await assert.rejects(stopOwnedChild(child, { graceMs: 5, killMs: 5 }), /not confirmed/);
});

test("real local owned process is killed while an unrelated process survives", { timeout: 5000 }, async (t) => {
  const script = 'process.on("SIGTERM",()=>{});process.stdout.write("ready\\n");setInterval(()=>{},1000)';
  const child = ownChild(spawn(process.execPath, ["-e", script], { ...OWNED_PROCESS_OPTIONS, stdio: ["ignore", "pipe", "ignore"] }));
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  t.after(() => { child.kill("SIGKILL"); unrelated.kill("SIGKILL"); });
  await once(child.stdout, "data");
  const exited = once(child, "exit");
  await stopOwnedChild(child, { graceMs: 20, killMs: 1000 });
  assert.deepEqual(await exited, [null, "SIGKILL"]);
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
  process.kill(unrelated.pid, 0);
});

test("an owned shell exiting normally cannot orphan its background descendant", { timeout: 5000, skip: process.platform === "win32" }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tunelito-owned-group-"));
  const heartbeat = join(dir, "heartbeat");
  const worker = `const fs=require('node:fs');const path=${JSON.stringify(heartbeat)};fs.writeFileSync(path,'ready');process.stdout.write('ready');setInterval(()=>fs.appendFileSync(path,'.'),10);`;
  const parent = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(worker)}],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>process.exit(0));`;
  const child = ownChild(spawn(process.execPath, ["-e", parent], { ...OWNED_PROCESS_OPTIONS, stdio: "ignore" }));
  t.after(() => { child.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); });
  await once(child, "close");
  const before = readFileSync(heartbeat, "utf8");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(readFileSync(heartbeat, "utf8"), before, "background work must stop with its owned group leader");
});
