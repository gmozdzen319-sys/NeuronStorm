# Pinned native Linux verifier

This is the existing reviewed in-memory go-quai harness, copied byte-for-byte.
No RPC, private keys, database or transaction submission is used by installation
or the synthetic verification test. Application code still requires a separate
explicit approval before paid execution. This installation does not grant it.

Render build command:

    npm install --prefix local-app && node local-app/wallet/native/install.mjs

Production executable setting (service root is repository root):

    NS_WALLET_NATIVE_VERIFIER=local-app/wallet/native/bin/quai-native
    NS_WALLET_NATIVE_VERIFIER_SHA256=e4a8c99d2aa90c6ee0971e0a015a6eca25bc4c0e8b8600f25bb32fb262b5efb5

The compressed artifact expands to a static Linux amd64 ELF (49,040,720 bytes),
compiled with Go 1.27.1 and Zig 0.13.0 targeting x86_64-linux-musl. The source
manifest pins main.go/go.mod/go.sum; go-quai is pinned to v0.56.1. The complete
dependency source locations and checksums are specified in go.mod/go.sum and
available through the Go module protocol. go-quai's license is included as
LICENSE.go-quai. Retain dependency notices when redistributing this artifact.

Equivalent cross-build environment (existing reviewed Windows toolchain):

    GOOS=linux GOARCH=amd64 CGO_ENABLED=1
    CC="zig cc -target x86_64-linux-musl"
    go build -mod=readonly -trimpath -ldflags "-linkmode external -extldflags -static" -o quai-native .

Installation verifies the uncompressed SHA-256, runs all 276 synthetic native
checks, and compares balances, runtime code and gas against the existing saved
reference. A failure stops the build. The per-platform evidence is generated,
not committed. Runtime/native compatibility is only verified once that Linux
test actually completes; compilation alone is insufficient.

This binary verifies execution on imported state; it is NOT an independently
validating consensus node and does not resolve the independent-RPC prerequisite.
