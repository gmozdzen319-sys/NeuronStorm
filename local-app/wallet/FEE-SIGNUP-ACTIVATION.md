# Automatic v3 wallets for new Passkey registrations

Production switch: NS_FEE_AUTO_ACTIVATE=true. Requires the existing confirmed fee-v3 manifest, fee Send enabled, no account test scope, the pinned native verifier, the existing relayer key file, and the approved official-single-source network policy. Legacy automatic activation and direct provisioning stay disabled.

Registration atomically reserves the fee-wallet assignment and inserts a new signup queue entry. Login, startup and migration never backfill this queue. Existing accounts and v2 assignments are not migrated. Compatibility records for the legacy account model are retained but are never provisioned by this worker.

The existing provisioner uses the deployed v3 factory, fresh dynamic gas estimate, complete access list and native/RPC preflight. The existing maximum of 40 QUAI per activation and 10 QUAI relayer balance margin apply. Every signup has one durable attempt and separate journal/grant. STOP, crash or ambiguity never causes automatic retry. Send and provisioning share the existing durable relayer lane and final nonce/state checks.

Receive is exposed only after a confirmed provisioning journal and verified deployed runtime. While waiting, no address/QR is exposed; the UI polls without submitting another transaction. After activation the existing fee Send and user-added token flow is used unchanged: measured gas + 15% allowance, plus 5% service fee, exact fresh Passkey preflight and STOP on quote overflow. The 2200 QUAI Send grant is not changed or reused to authorize provisioning.

Migration 011 creates empty signup/attempt/diagnostic tables only; it does not alter users, old wallets, balances or journals. No new implementation or factory deployment is needed.
