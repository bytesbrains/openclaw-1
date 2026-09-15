import { describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";
import {
  createCronStoreHarness,
  createNoopLogger,
  installCronTestHooks,
  writeCronStoreSnapshot,
} from "./service.test-harness.js";

const noopLogger = createNoopLogger();
const { makeStorePath } = createCronStoreHarness();
installCronTestHooks({ logger: noopLogger });

describe("add() must not drop a due every-job's pending run", () => {
  it("preserves a due every-job nextRunAtMs when an unrelated job is added", async () => {
    const store = await makeStorePath();
    const base = Date.parse("2025-12-13T00:00:00.000Z");
    const lastRunAtMs = base + 10_005;
    const dueSlot = lastRunAtMs + 10_000;
    const nowDue = dueSlot + 50;
    const jobId = "due-every";
    await writeCronStoreSnapshot({
      storePath: store.storePath,
      jobs: [
        {
          id: jobId,
          name: "every 10s",
          enabled: true,
          createdAtMs: base,
          updatedAtMs: lastRunAtMs,
          schedule: { kind: "every", everyMs: 10_000, anchorMs: base },
          sessionTarget: "isolated",
          wakeMode: "next-heartbeat",
          payload: { kind: "agentTurn", message: "tick" },
          delivery: { mode: "none" },
          state: { lastRunAtMs, nextRunAtMs: dueSlot },
        },
      ],
    });
    vi.setSystemTime(new Date(nowDue));
    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    });
    try {
      await cron.add({
        name: "unrelated daily",
        enabled: true,
        schedule: { kind: "cron", expr: "0 9 * * *" },
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        payload: { kind: "agentTurn", message: "daily" },
      });
      const current = (await cron.list({ includeDisabled: true })).find((j) => j.id === jobId)!;
      expect(current.state.lastRunAtMs).toBe(lastRunAtMs);
      expect(current.state.nextRunAtMs).toBe(dueSlot);
      expect(current.state.nextRunAtMs).toBeLessThanOrEqual(nowDue);
    } finally {
      cron.stop();
    }
  });
});
