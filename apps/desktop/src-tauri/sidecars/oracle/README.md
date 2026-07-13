# DataPad++ Oracle sidecar

This self-contained .NET 8 sidecar provides the built-in Oracle 19c+ runtime. It uses Oracle's fully managed ODP.NET Core provider and communicates with the Rust desktop process through newline-delimited JSON on stdin/stdout. It never opens a local listening port.

The desktop process owns connection guardrails and sends resolved credentials only in the stdin request envelope. The sidecar must not log request payloads, connection strings, or Oracle diagnostic payloads that may contain secrets.

Build the current platform binary with:

```powershell
node tests/release/prepare-oracle-sidecar.mjs
```

The release workflow publishes a self-contained, untrimmed single-file binary for each Tauri target. Docker is used only by the optional Oracle fixture validator and is not a runtime requirement.
