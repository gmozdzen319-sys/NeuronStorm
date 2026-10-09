# Neuron Storm wallet integration — v0.18.5

## Release boundary

This application release sends **no Mainnet transaction** by default. Both execution flags default off, the additive migration creates **no sponsorship grants or approvals**, and a new account receives a permanent database assignment, not an immediately funded/deployed wallet. The UI never exposes an undeployed address for receiving funds.

Existing infrastructure is pinned, not redeployed:

- Chain 9, Cyprus-1.
- Implementation `0x0053e2f57997c487F23de01726290eF6937f2bf0`.
- Factory `0x00313F663E19d718B3BCCfcD37f81D11dd475F6C`.
- RP `neuronstorm.onrender.com`; origin `https://neuronstorm.onrender.com`.

No experimental clone, test credential, prior assertion, funding operation, NS transfer or old execution authorization is assigned to application users.

## Implemented flow

Verified ES256 registration creates one deterministic clone assignment in the same PostgreSQL transaction as the account. Existing supported-domain accounts obtain an assignment on their first wallet read. Account and credential foreign keys, unique wallet/key constraints and an immutable assignment trigger prevent reassignment and accidental sharing. Registration on localhost cannot provision a wallet against the production-domain implementation.

The Wallet screen uses the existing styles and shows verified QUAI balance, Receive/address/QR, native Send/review/Passkey, token metadata and credential listing. Returning login resolves the same database identity and assignment. Recent transfer state survives restart/logout. Pelagus/BillPay remain separate; their application routes and identity semantics are unchanged.

Receive checks chain ID, both infrastructure runtime hashes, factory prediction/mapping, clone runtime and the account's on-chain key. Reads use a pinned observation block and ancestry/header checks. A predicted address, RPC failure or inconsistent assignment is not displayed as a deposit address or fake zero balance.

Send persists a new short-lived operation, independently verifies a new UP/UV ES256 assertion, then verifies the exact signed client/authenticator bytes in the contract/native preflight. The challenge binds wallet, chain, epoch, wallet nonce, action 5, recipient, amount and deadline. Unique challenge digests prevent reuse even for identical requests made within the same second by counter-zero synced credentials. Login never grants transfer authorization.

The server freezes the fee recommendation and validates exact calldata, value zero, chain ID, complete access list, decoded signed transaction and current account state. Native go-quai and RPC simulations must agree. The transaction hash/intent and maximum fee reservation are committed before the sole broadcast request. Ambiguity retains a durable lock, including after restart. There are no automatic retries, replacements or gas-limit increases.

## Provisioning and approval

`wallet/provisioning-quote.mjs` computes a read-only per-account factory call and fee quote. With the pinned native verifier supplied, it additionally runs native preflight using reconstructed committed factory storage. `createCloneProvisioner.quote(accountId)` records that quote **unapproved**. The operator must review the exact commitment, expected fee, maximum fee, balance and 10 QUAI safety margin before separately approving that record and a bounded sponsorship grant.

Operator quote command: `node local-app/wallet/quote-account.mjs <account-id>` with `DATABASE_URL`, the intended `NS_WALLET_RELAYER_ADDRESS`, and pinned native-verifier path/hash configured. This command has no signing or broadcast capability and prints the cost/commitment for review. It must not be confused with authorization to execute the quote.

Only an enabled worker with an unexpired, explicitly approved quote can execute `createWallet` on the existing factory. It never deploys implementation/factory contracts or repeats funding. Confirmation verifies the existing user assignment, runtime, key and wallet nonce before Receive becomes available. A shared database lane serializes this with native sends. Failed/expired/ambiguous jobs are not automatically retried. Explicit requoting of an expired/stopped job retains trigger-backed history.

Limits: native Send 1,000,000 gas; clone creation 330,000 gas; price cap 75,000 Gwei; relayer safety margin at least 10 QUAI. The actual permitted exposure is further bounded by the separately approved grant. These are limits, **not a current fee estimate or spending authorization**. A cost quote requires the actual registered user's key and the chosen relayer/current chain state. No new production-user quote or paid activation was performed during this integration.

## Deployment configuration and remaining activation gates

Paid execution requires all of the following, configured only after a separate review:

- `NS_WALLET_SEND_ENABLED=true` and/or `NS_WALLET_PROVISION_ENABLED=true`.
- `NS_WALLET_RELAYER_ADDRESS`, a server-only `NS_WALLET_RELAYER_KEY_FILE`, and `NS_WALLET_GRANT_ID` naming an approved database budget.
- A deployed native go-quai verifier via `NS_WALLET_NATIVE_VERIFIER` and its exact `NS_WALLET_NATIVE_VERIFIER_SHA256`. The reviewed Windows laboratory executable is **not** assumed to run on Render/Linux. A compatible production build/distribution still needs verification.
- `NS_WALLET_SECONDARY_RPC` and `NS_WALLET_NETWORK_POLICY=reviewed-independent-v1`, only after the operator establishes a trustworthy production verification source. Merely supplying another URL does not establish independent consensus validation.
- For each new wallet: a fresh native/RPC-verified quote and separate explicit fee approval. No HTTP route grants approval or changes sponsorship budgets.

Those activation requirements are not satisfied merely by deploying this application. Until configured and approved, signup persists the assignment and displays activation pending; existing verified wallets can Receive, while Send remains unavailable. No test relayer key is automatically exported or installed on Render.

## Known limitations and security differences

The controlled test's waiver of independent RPC verification applied to that test only. It is not reused for public execution. Three receipt observations (four for provisioning so the deployment reaches the Receive read anchor) are bounded application policies, **not PoEM finality claims**. Temporary missing/orphaned/reincluded receipts remain pending; inconsistent contents, unprovable ancestry and mismatched state stop execution. There is no guaranteed-finality threshold invented here.

Factory history reconstruction is bounded to 65,536 blocks and fewer than 10,000 events per requested range. Beyond the bound, provisioning stops and requires a reviewed indexed snapshot; it never silently truncates context. Native Send currently requires the reviewed one-key storage profile. Adding/revoking keys and recovery are not enabled by this release. There is no guardian/master spending key. Losing all access to the authorized Passkey is not recoverable through the backend.

As in v0.18.4, Passkey community-profile/posting integration is not enabled; existing Pelagus/BillPay Q&A, Debate, reputation and profiles are preserved. NS balance remains explicitly unavailable in this Passkey screen, and this release performs no NS operations. Token registration remains metadata-only.

WebAuthn authenticates the relying party and challenge; it does not provide a trusted hardware display of transaction details. Protection against a malicious production frontend remains a separate unsolved UX/trust boundary and is not claimed solved by this integration.

## Validation evidence

Local PostgreSQL regression, production-domain synthetic P-256 assertion tests, clone uniqueness/restart persistence, new executor/provisioner tests, receipt monitoring tests, and browser checks at 1440/390/320px are recorded in `outputs/wallet-*.txt` (local ignored artifacts). Browser tests use isolated virtual credentials and HTTP doubles; executor/provisioner tests use fake broadcast capabilities. They do not establish that paid production execution is activated.

The existing sender/clone suite passed 379 of 381 on the first run because the retired local enrollment server was stopped. Its two UI-only tests then passed with that server temporarily started and its session file restored. No Mainnet experiment was repeated. A read-only infrastructure check confirmed both pinned runtime hashes on chain 9.

Applied migrations 001–003 are unchanged. Migration 004 only adds wallet assignments, operation/approval journals, sponsorship accounting and locks. It does not reset existing data. Deployment and final test totals are reported in the task's final response after verification.
