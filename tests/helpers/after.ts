// On globalThis, so the queue survives the vi.resetModules() every test runs.
const store = globalThis as { __afterTasks?: Promise<unknown>[] };
const queue = () => (store.__afterTasks ??= []);

/** Stands in for Next's after(), which throws without a live request. */
export function runAfter(task: (() => unknown) | Promise<unknown>): void {
  queue().push(Promise.resolve(typeof task === "function" ? task() : task));
}

/** Waits for every after() task, so a test sees the notices a response left behind. */
export async function settleAfter(): Promise<void> {
  while (queue().length) await Promise.all(queue().splice(0));
}

/** A route's response, handed back once the work it left for after() is done. */
export async function settled<T>(response: Promise<T>): Promise<T> {
  const res = await response;
  await settleAfter();
  return res;
}
