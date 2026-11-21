import type {Host, ViewHandle} from "./view/run.ts";

export interface PocketGolfMount {
  element: HTMLElement;
  dispose(): void;
}

export function mount(host: Host): PocketGolfMount {
  const body = host.ui.make("div", "window-content pocket-golf");
  const status = host.ui.make("div", "app-status", "Loading Pocket Golf…");
  body.append(status);
  const controller = new AbortController();
  let disposed = false;
  let view: ViewHandle | null = null;

  const abort = () => controller.abort(host.signal?.reason || "View removed");
  host.signal?.addEventListener("abort", abort, {once: true});
  if (host.signal?.aborted) abort();

  queueMicrotask(() => {
    void import("./view/run.ts").then(async ({startView}) => {
      if (disposed || controller.signal.aborted) return;
      const candidate = await startView(host, controller.signal);
      if (disposed || controller.signal.aborted) {
        candidate.dispose();
        return;
      }
      view = candidate;
      body.replaceChildren(view.element);
    }).catch(error => {
      if (!disposed && body.isConnected && !status.isConnected) return;
      status.textContent = "Could not start Pocket Golf: " + (error instanceof Error ? error.message : "unknown error");
    });
  });

  return {
    element: body,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      host.signal?.removeEventListener("abort", abort);
      controller.abort("View removed");
      view?.dispose();
      view = null;
    },
  };
}
