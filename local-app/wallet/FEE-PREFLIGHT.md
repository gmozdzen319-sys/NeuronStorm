# Quoted Send preflight

`sendQuoted` binds `msg.sender` and `tx.gasprice` to the Passkey-signed quote.
The contract and the deployed receive-compatible proxy are unchanged.

Quai v0.56.1's RPC `TransactionArgs.ToMessage` sets execution gasPrice to zero.
Consequently `quai_call`, `quai_createAccessList`, and `quai_estimateGas` are not
execution authorities for this price-bound method. Ignoring a revert or changing
the signed quote to zero is forbidden.

For fee Send only, `fee-native-preflight.mjs` uses the pinned, self-tested go-quai
binary to execute unchanged contract code with the actual frozen price, nonce,
value, calldata, assertion, gas limit, and historical block context. Discovery
is bounded to six read-only iterations. Every newly observed address/slot is
captured from the same canonical RPC block before success is accepted. Discovery
alone is not success: the final execution must use Debug=false and the complete
list, with committed storage, and succeed within the original gas limit.

The complete transaction is then committed and immutable. Subsequent pre-sign
and pre-broadcast gates must reproduce the exact access list, prove ancestry,
re-read relevant account/code/storage/balances/nonces, execute again, and preserve
the plan commitment. Signed bytes are decoded and compared with that plan.
No RPC execution error is converted into a successful simulation.

RPC remains the chain-state/receipt source; its previously documented single
official endpoint trust limitation remains. This is deliberately a native
execution authority, not a claim of two independent execution confirmations.
The existing network verification policy, Passkey verification, receipt checks,
budget reserve, durable journal, and prohibition on retry/replacement remain.

The preflight never increases gas, changes quote amounts, creates an assertion,
or signs/broadcasts. An expired assertion is usable only for historical read-only
diagnosis, never for a new transaction. Deployment/provisioning and legacy V2
Send keep their existing preflight paths.
