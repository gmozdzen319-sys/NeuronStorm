# V3 factory history checkpoint

Scope: the existing pinned `NeuronStormFeeFactory` only. Legacy v1/v2 readers,
Send, contracts, authorization, fees and transaction retry rules are unchanged.

The factory constructor starts with nonce 1. Its only state-changing method
performs one CREATE2, initializes the clone, stores one immutable `walletOf`
entry and emits one `WalletCreated`. Any failure reverts the complete call.
The reviewed go-quai `EVM.create` increments the creator nonce and initializes
the new contract nonce to 1; the enclosing call reverts on failure. Therefore
factory nonce minus 1 is the number of successful wallet creations. This
property must not be generalized to arbitrary factories.

The reader verifies the pinned runtime and deployment receipt. It processes
windows of 65,536 blocks, with at most 16 windows and 4,096 nonempty recursive
range nodes per invocation. These are work bounds, not a factory age limit.
Equal nonce counts at the window boundaries prove there were no successful
creations in that window. Nonempty windows are split using intermediate nonce
counts until log requests cover at most 1,024 blocks. The exact number of logs
must match the nonce difference; missing, duplicate, removed, wrong-address or
noncanonical logs cause failure. Every discovered mapping is checked on-chain.

Each fully checked window is persisted in PostgreSQL with its full block
context and complete key/wallet pairs. Identity includes chain, factory address,
deployment transaction, implementation address and both runtime hashes. The
database lock prevents checkpoint regression by concurrent readers. On restart
the checkpoint hash/context, nonce cardinality and mappings are rechecked.
Canonicality is checked before persistence and after reads. A mismatched stored
checkpoint fails closed; it is never silently erased or replaced with a fork.
Existing bounded ancestry verification also remains in use for nearby heads.

Production warms history before claiming a fresh activation or loading its
signer. A work-bound stop leaves verified progress in the checkpoint and does
not create an activation attempt or spend anything. The normal worker can
continue history synchronization on its next tick. Previously stopped or
ambiguous account attempts remain excluded; this is not a transaction retry.
After synchronization the existing fresh quote and all execution gates run.

Completeness is checked against the RPC's pinned nonce and mappings, rather
than inferred from an empty `getLogs` response. This retains the documented
official-single-RPC trust limitation; it is not independent consensus proof.
A real reorg, inconsistent node or inaccessible historical state still stops
the reader. No history is truncated or invented to make activation succeed.
