# Wallet network verification

Paid execution remains disabled by default. Setting a network policy alone does not enable it, create an approval/grant, load a key, or send a transaction.

`reviewed-independent-v1` requires a separately configured reviewed RPC. A failure never falls back to another policy.

`official-single-source-v1` is the explicitly owner-selected alternative (2026-10-10). It uses https://rpc.quai.network/cyprus1 for consistency observations. It does **not** establish independent validation or consensus finality: a compromised or consistently incorrect official provider may defeat observations from that same provider. Repeated reads are not independent sources.

Both modes require chain 9, exact pinned canonical blocks, matching balance/nonce/code and complete supplied storage snapshots. Existing bounded stabilization/ancestry, native execution, access-list, transaction commitment, budget, signature, receipt, replay and no-resubmission checks remain mandatory and unchanged. Inconsistency or unavailable RPC fails closed. No finality threshold is invented.

Separate relayer signing configuration, an explicit bounded sponsorship grant, a fresh per-account quote/approval, and the relevant execution flag are still required before paid provisioning. No test credential or test wallet becomes a user wallet.
