// api.js — calls Gaia Symbiosis's SubSync server (/api/subsync) with the visitor's
// Google sign-in. The AI and subtitle keys stay on the server; none are in the browser.

export function signedIn() {
  return typeof window.gethiredSignedIn === 'function' && window.gethiredSignedIn();
}

/** Resolves to the server's reply, or throws an Error whose message is the error code. */
export async function call(payload) {
  if (typeof window.gethiredCall !== 'function') throw new Error('signin-unavailable');
  const reply = await window.gethiredCall('/api/subsync', payload);
  if (!reply || !reply.ok) {
    const err = new Error((reply && reply.error) || 'server');
    err.detail = reply && reply.detail;
    throw err;
  }
  return reply;
}
