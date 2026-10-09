# Neuron Storm Passkey integration — staged release

This is application code, not the Mainnet experiment. It is **not a completed production wallet release**. No test keys, test wallet addresses, LabToken state, old assertions, relayer keys, or old broadcast permissions are imported.

## Implemented application boundary

- One English Log in / Sign up entry, native modal, Passkey / Pelagus / BillPay choices. BillPay opens the existing BlipPay integration; its provider protocol is unchanged.
- ES256 registration and discoverable Passkey login using pinned `@simplewebauthn/server` 13.3.3, UV and UP, explicit RP/origin, original signed client bytes, duplicate JSON-key rejection, cross-origin rejection, one-time browser-bound challenges, counters and hashed sessions. No private authentication key is stored on the backend.
- Additive PostgreSQL migration `003_passkey_accounts.sql`: separate stable account ID, random user handle, public credentials, sessions, challenges, one unique pending wallet record per identity and per-account token watchlist. Legacy address-based accounts and reputation are unchanged.
- Returning Passkey reaches the same identity and provisioning record. It does **not** yet have a deployed wallet/address. Database constraints deliberately disallow an `active` wallet state in this release.
- Passkey dashboard, truthful unavailable balances, token metadata review and off-chain watchlist, authorized-credential list. Token labels are untrusted display text. Metadata calls cannot sign or broadcast.
- Receive, Send, pairing and revocation return HTTP 423, even if a caller bypasses the disabled controls. No deposit QR/address is emitted. Login never authorizes a financial operation.
- Passkey sessions cannot be used on legacy wallet APIs, create synthetic wallet addresses, or merge with Pelagus/Blip identities. Community profile/posting for Passkey accounts is not yet connected.

## Production activation is OFF by default

`NS_PASSKEY_ENABLED` defaults false. Existing wallet methods continue working. Registration is not opened merely by deploying this code.

For **local evaluation only**, the tested configuration is:

```
NS_PASSKEY_ENABLED=true
NS_PASSKEY_ORIGIN=http://localhost:3338
NS_PASSKEY_RP_ID=localhost
```

An explicit production origin/RP decision is required before enabling public registration. Changing a deployment host does not migrate existing credentials. The code requires an exact origin and matching hostname, with HTTPS outside localhost. It never trusts a request Host header to choose the RP.

There is no wallet-enablement flag or relayer secret in this release. Setting registration flags does not enable fund movement.

## Contract review and precise blockers

Reviewed foundation: `experiments/quai-passkey/BrowserProbe.sol`, `Probe.sol`, `ClientData.sol` and sender/native canonicality evidence. The successful Mainnet lifecycle remains useful evidence for P-256, semantic client JSON validation, full access lists, receipt sequencing and Quai execution costs. It is not a production security audit.

The tested contract contains `NS-PASSKEY-LAB-v1` / `NS-RECOVERY-LAB-v1`, immutable RP/origin and a guardian recovery path. The successful test's guardian arrangement is not independent recovery. The contract supports ERC-20 transfer, not the requested native QUAI sending flow. A frontend/backend compromise can still replace the operation shown before the user signs a challenge. A WebAuthn device prompt does not display and attest token/receiver/amount.

Required decisions and work before wallets can be activated:

1. Final RP/domain and credential lifecycle. No silent switch to another domain.
2. Independent trustworthy signing/review surface and deployment authority. A subdomain served by the same compromised backend is insufficient. Fail-closed relayer checks do not solve malicious operation presentation.
3. Production contract profile: use a production signing domain; explicitly disable recovery until a reviewed independent scheme exists, or specify and review a real guardian policy. Do not silently use the login key as recovery. Native QUAI transfer would need its own reviewed operation and tests.
4. Freeze and review production bytecode/compiler/dependencies, rerun the native Quai suite and exact real-browser assertion tests after changes. Do not assume the lab bytecode runtime hash applies to a changed contract.
5. Configure separate production relayer authority, sponsorship/rate limits and budget. The test relayer is not available to application users.

## Recommended first per-user deployment model (not deployed)

Start with **one directly deployed, non-upgradeable contract per user**, retaining the tested constructor and verification structure after the explicit production changes above. Factory/proxy execution, initialization and storage layouts have not been equivalently verified; this release does not invent or deploy them.

The unique account provisioning row is the identity anchor. A later additive migration must add an immutable unique `(chain_id, wallet_address)` mapping only after verified creation, runtime and constructor/key/RP state. Provisioning needs a durable job and cross-process lock, exact approved code/key/origin commitment, current relayer nonce and Quai shard grinding. Never assign a hypothetical address as a receivable wallet. A timeout or ambiguous submission must lock the job for investigation, not deploy a replacement wallet.

Carry the reviewed sender invariants into a separately reviewed application adapter: fresh full address+storage-key access list, Debug=false native/RPC preflight on the exact assertion, frozen gas price, hard limits, balance reserve, canonical ancestry and relevant state, one broadcast, durable journal before submission, verified canonical receipt before proceeding. Never import fixed fixture addresses/nonces or executable old attempt wrappers.

## Second-device and revocation design (blocked, not faked)

The required flow is pending pairing → second-device public credential → trusted-device authorization bound to exact new key/account/wallet → confirmed on-chain key addition → activation of that credential for login. Pairing must expire, be single-use and not grant access through possession of a QR. A fresh trusted assertion and on-chain confirmation are required; the backend cannot mark its own added key as an authorized wallet owner.

Revocation similarly requires a confirmed key-removal operation before changing wallet authorization, with last-key protection and immediate invalidation of sessions for the revoked credential. Synced credentials are not a reliable list of physical devices. Recovery after loss of every authorized credential is **not implemented**. No pending pairing API is exposed as if it already enrolled another device.

## Validation

- `node local-app/test/run.mjs`: existing regression plus new real P-256 account tests using isolated PGlite.
- `node local-app/test/run-postgres.mjs`: full suite on disposable PostgreSQL, including independent-session race tests.
- `local-app/test/passkey-browser.mjs`: explicit local Edge/Playwright smoke with a disposable virtual authenticator; desktop/390px/320px, registration, return login, reload/logout, credential list, blocked send, Pelagus dispatch. No real credential or Mainnet authorization is simulated.
- Sender, on-chain replay/substitution, receipt ambiguity, pairing/revocation, Receive QR and native QUAI sending are **not application-level passing tests** in this release. They remain blocked; prior lab results are not relabelled as application tests.

## Deployment and rollback

Only application files and the additive migration may be pushed. Exclude experiments, credentials, logs, unrelated deleted screenshots and local runtime files. No database reset or backfill. Existing migration checksums remain unchanged.

Verify health, release identity, public statistics, unified UI, legacy login regression and `GET /api/passkey/config` returning both flags false. Public counts cannot prove every private production record is intact; the local PostgreSQL preservation/regression tests provide additional evidence. Real Pelagus/Blip signing on the live site requires its owner's interaction and is not claimed from read-only checks.

Rollback application code if necessary; leave the additional empty tables in place. Do not delete production data. Production wallet deployment, paid device-key changes and any transfer require a subsequent reviewed implementation and separate blockchain authorization. No paid transaction is included in this application release.
