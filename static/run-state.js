export const receipts = new WeakMap();

export async function withCallDeadline(controller, task, reason = 'OpenRouter took too long.') {
  controller.signal.throwIfAborted();
  const timer = setTimeout(() => controller.abort(reason), 60_000);
  try {
    return await task();
  } finally {
    clearTimeout(timer);
  }
}
