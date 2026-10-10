# Automatic activation

Disabled by default. Explicit operator setting `NS_WALLET_AUTO_ACTIVATE=true`
enables sponsorship for all eligible Passkey clone assignments, including existing
unapproved accounts. Uses the existing Render secret file, pinned relayer,
implementation/factory and official-single-source-v1 policy. No additional key.
Keep `NS_WALLET_PROVISION_ENABLED=false`; Send is controlled separately and is
not enabled by this change.

Every account gets one permanent attempt and a separate grant of exactly
15 QUAI. Fresh RPC/native quotes bind the immutable wallet assignment. The existing
sender freezes the gas price, revalidates nonce/access list/state/canonicality,
persists the signed hash before its sole broadcast, and verifies the receipt.
The relayer must retain its existing 10 QUAI safety reserve. No gas limit increase.

PostgreSQL serializes the automatic worker across processes. Restart or ambiguous
submission never reclaims a running attempt. A stopped/failed attempt requires
manual investigation, not automatic retry. Previously approved/submitted/history
records are excluded. Only unapproved, expired quotes can be refreshed automatically.
Confirmed wallets are never provisioned again. Schema migration 005 is additive.

Read-only log queries are serialized. The exact RPC error `too many concurrent
log queries; retry later` permits at most three reads of the identical pinned
range, with 2/4 second backoff. No other RPC error is retried, and broadcast has
no retry path. Factory history is cached only across verified canonical ancestry;
new blocks are scanned incrementally and fork disagreements still stop execution.

Migration 006 adds durable, sanitized failure stages/categories. SDK exception
objects, private keys and signed bytes are never written to these diagnostics.
Historical STOPs predating this migration cannot retrospectively reveal the
original exception; fresh read-only rehearsal is not proof of an old failure.

`review-stopped-activations.mjs --execute-reviewed <account IDs>` is a separate
explicit operator action, never called by the automatic worker. It accepts only
stopped, unbroadcast accounts with no submitted/failed/confirmed transaction in
their history, no fee reservation and no unresolved relayer work. It preserves
the assignment, old grants and approval history, records the review, and creates
a fresh 15 QUAI grant. Every normal quote/native/RPC/signing/receipt gate still
runs. Any STOP ends the batch; no automatic reapproval follows.

The worker runs once at startup and every 10 seconds while the app is awake;
the Free Render service can sleep. Wallet UI polls read-only during activation.
No secret or exception object is logged. Deployment/build itself does not run a
provisioning command; execution is explicitly enabled only in the runtime.

The 15 QUAI limit is PER ACCOUNT, not an aggregate sponsorship budget. A person
can register multiple Passkeys/accounts; this is not proof of unique humanity.
Public signup sponsorship can consume relayer funds down to the safety reserve.
Disable the runtime flag to prevent new attempts; do not terminate an in-flight
broadcast to attempt a replacement. No independent consensus finality is claimed.

Verification uses a disposable PostgreSQL database and the existing real sender
with local RPC/native fixtures: success, immutable assignment, concurrent workers,
fresh quote of a legacy pending account, budget boundaries, insufficient balance,
nonce/input/address mutation, missing proof, stale quote, ambiguous send and crash.
