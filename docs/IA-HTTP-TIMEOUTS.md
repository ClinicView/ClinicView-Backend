# HTTP timeouts for long OCR jobs

IA v2 processes a document synchronously and can wait several minutes before
sending its HTTP response headers. An `AbortSignal.timeout(1800000)` alone did not
prevent an earlier failure: Node's bundled Undici independently defaults to a
300-second headers timeout (and a separate 300-second body inactivity timeout).

`IaClientService.process()` now uses an application-owned Undici `Agent.request`:

- `headersTimeout` and `bodyTimeout` explicitly use `ia.processTimeoutMs`;
- one total `AbortSignal` covers connection/queue, headers and the complete body;
- connection establishment remains bounded to `min(10 seconds, total budget)`;
- the timeout cannot be disabled or made infinite (maximum two hours);
- `idempotent:false`, no retry interceptor and no redirect interceptor: an OCR
  POST is not silently replayed following errors, disconnection or a redirect;
- the agent is private, so no global dispatcher/settings are changed;
- module shutdown destroys the agent and releases its pending sockets.

The default remains 30 minutes (`IA_PROCESS_TIMEOUT_MS=1800000`). A genuine timeout
does not prove that the remote inference stopped; check its immutable run artifacts
before a manual retry. Restarting the backend also aborts active requests, so do not
restart it mid-OCR when you need the current result. This change does not implement
a job queue, polling, recovery/import of an abandoned run or automatic retries.

The dependency is pinned to Undici 7.29.1, requiring Node >=20.18.1, compatible with
the project's Node 20/22 CI and the tested local Node 24.11.0. Undici 8 is not used
because it would raise the Node minimum and break the current Node 20 target.

Tests use real localhost HTTP sockets and synthetic text only. They verify explicit
transport budgets, delayed headers/body, stalled responses, continuous-body total
timeouts, no redirect/retry, and lifecycle cleanup. The time-based tests use short
budgets rather than waiting 30 minutes; they also assert the actual production
1,800,000 ms headers/body/total configuration passed to the dispatcher.

Primary references checked 2026-09-11:

- [Undici 7.29.1 Client options](https://github.com/nodejs/undici/blob/v7.29.1/docs/docs/api/Client.md)
  documents the independent defaults and connector timeout.
- [Undici 7.29.1 Dispatcher](https://github.com/nodejs/undici/blob/v7.29.1/docs/docs/api/Dispatcher.md)
  documents per-request timeouts, idempotence and lifecycle.
- [Undici 7.29.1 package metadata](https://github.com/nodejs/undici/blob/v7.29.1/package.json)
  specifies the Node runtime requirement.
