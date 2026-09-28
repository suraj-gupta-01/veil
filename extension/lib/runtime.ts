type Handler = (msg: any, sender: any) => unknown;

export function listen(target: string, handler: Handler) {
  browser.runtime.onMessage.addListener((msg: any, sender: any, sendResponse: (r: unknown) => void) => {
    if (!msg || msg.target !== target) return false;
    let r: unknown;
    try {
      r = handler(msg, sender);
    } catch (e) {
      sendResponse({ __error: String(e) });
      return false;
    }
    if (r instanceof Promise) {
      r.then(sendResponse, (e) => sendResponse({ __error: String(e) }));
      return true;
    }
    if (r !== undefined) sendResponse(r);
    return false;
  });
}

export async function call<T>(msg: object): Promise<T> {
  const r: any = await browser.runtime.sendMessage(msg);
  if (r && r.__error) throw new Error(r.__error);
  return r as T;
}

export function emit(event: object) {
  browser.runtime.sendMessage({ target: 'panel', ...event }).catch(() => {});
}
