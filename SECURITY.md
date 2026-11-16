# Local security model

The preview binds only to loopback port 47842. All private HTTP reads/mutations require a bearer credential; mutations additionally require a compatible build ID. The WebSocket session sends its credential as a subprotocol header, never in a URL. Origin checks supplement authentication; opaque CEP origins alone are not authorization.

Installation creates `config/session-token` locally. The CEP panel reads it through its Node context from the installed checkout. It is excluded from Git, exported configuration and public bundles. Protect the checkout/config directory with the current user's OS permissions. The engine and panel run with that user's privileges; other processes running as the same user are outside this boundary.

Never paste credentials, logs, raw run artifacts or private project paths into public issues. Rotate a leaked local session credential by stopping the preview engine, removing only its local token file, rerunning bootstrap, and reopening the panel. Do not change another installation's settings.

Unknown write outcomes are reconciled through a host completion barrier and timeline readback. Ownership receipts and generated clip identities gate replay. Manual conflicts and incomplete clone initialization fail closed. This is conservative recovery, not a transaction or undo guarantee. Premiere/QE behavior requires live validation.
