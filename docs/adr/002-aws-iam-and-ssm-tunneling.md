# ADR-002: AWS-native auth (SSO, IAM, RDS IAM tokens) and SSM tunneling

- Status: Accepted
- Date: 2026-11-23

## Context

Target users reach RDS through AWS IAM Identity Center (SSO) profiles. Their databases
usually sit in private subnets with no bastion SSH keys, only SSM-managed EC2
instances. Long-lived DB passwords are discouraged. We want "pick a profile → pick a DB
→ connected" in about 30 seconds, without the user touching the CLI.

## Decision

1. **Credentials come from the user's existing AWS config.** We parse `~/.aws/config`
   and `~/.aws/credentials` for profile discovery, then resolve credentials with
   `@aws-sdk/credential-providers` (`fromIni`, which handles SSO, `role_arn` chains and
   static keys). ViewDeck never stores AWS credentials.
2. **SSO login is delegated to the AWS CLI.** We run `aws sso login --profile <name>`,
   track the child process, and treat successful exit plus successful credential
   resolution as "authenticated". We do not reimplement the device-code flow. The CLI
   owns the token cache in `~/.aws/sso/cache`, which keeps it in sync with the user's
   terminal.
3. **RDS IAM auth signs a token per physical connection.** `@aws-sdk/rds-signer`
   produces a SigV4 presigned token valid for **15 minutes**. `pg.Pool` is configured
   with `password: async () => signer.getAuthToken()`. Each new socket signs a fresh
   token, while established sessions keep running past the token's expiry (it is only
   checked at handshake time).
4. **Private RDS uses SSM port forwarding.** We spawn `aws ssm start-session --target
   <instance> --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters
   host=<rds>,portNumber=<5432>,localPortNumber=<free>` bound to `127.0.0.1`. Candidate
   targets are EC2 instances in the RDS instance's VPC that SSM reports as `Online`.
   `SsmTunnelManager` tracks every child process and tears them all down on disconnect,
   crash, and `before-quit` / `will-quit`.
5. **TLS over the tunnel verifies the real endpoint.** The socket targets `127.0.0.1`,
   but the RDS certificate is issued for `*.rds.amazonaws.com`. We pass
   `ssl: { ca: <bundled global-bundle.pem>, servername: <rds endpoint> }` so SNI and
   hostname verification run against the RDS name.

## Consequences

- It requires the AWS CLI v2 and `session-manager-plugin` on `PATH` for SSO login and
  tunnels. Their absence is detected and surfaced as `SSM_PLUGIN_MISSING` with install
  instructions, not as a generic spawn error.
- Electron apps launched from Finder get a minimal `PATH`. The tunnel and SSO services
  must look in the common install locations too (`/opt/homebrew/bin`,
  `/usr/local/bin`, `/usr/local/sessionmanagerplugin/bin`).
- The RDS CA bundle ships in `resources/` and must be refreshed when AWS rotates CAs.
- Each token-signing call resolves credentials. The SDK provider caches and refreshes
  role credentials, so this is cheap. An expired SSO session surfaces on the next new
  connection as `AWS_SSO_EXPIRED`.

## Alternatives considered

- **Cache one token per pool:** breaks after 15 minutes for every new connection.
  Rejected.
- **`rejectUnauthorized: false` over tunnels:** silently disables MITM protection.
  Rejected.
- **Embedding the SSM WebSocket protocol in-process:** removes the plugin dependency,
  but the protocol is undocumented and fragile. Revisit only if distribution pain
  demands it.
- **SSH bastions:** may be added later as a second `TunnelProvider`. SSM is the default
  because it needs no keys or open ports.
