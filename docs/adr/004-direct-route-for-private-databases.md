# ADR-004: Direct route for private databases (VPN / peered networks)

- Status: Accepted (amends ADR-002 §4)
- Date: 2026-11-23

## Context

ADR-002 routed every non-public RDS database (`PubliclyAccessible = false`) through an
SSM port-forwarding tunnel. In real use that is too strict. Many teams reach private
RDS endpoints directly over a corporate VPN, VPC peering, Transit Gateway or Direct
Connect, typically with:

```sh
PGPASSWORD="$(aws rds generate-db-auth-token --profile … --hostname $H --port 5432 --username …)" \
  psql "host=$H port=5432 dbname=… user=… sslmode=require"
```

Those users' roles often lack `ssm:DescribeInstanceInformation` / `ssm:StartSession`,
because they never needed them. The wizard then had no usable path: the tunnel host list
failed with `AWS_ACCESS_DENIED`, and Save stayed disabled.

## Decision

- Wizard step 3 asks private databases for a **network path**: **Direct (VPN / peered
  network)** or **SSM tunnel**. The default stays SSM tunnel for private databases, as
  ADR-002 had it, and Direct for public ones.
- The SSM host lookup only runs while "SSM tunnel" is selected. If it fails (e.g.
  access denied) or finds no hosts, the UI offers a one-click "Use Direct instead".
- A Direct route to a private database is an ordinary `route.kind = 'direct'`
  connection. It keeps RDS IAM auth (token signed for the endpoint) and `verify-full`
  TLS with the bundled RDS CA. That is stricter than the `sslmode=require` users often
  type by hand, and still compatible.

## Consequences

- Nothing changes in main, the driver, or the saved-connection schema. `direct` routes
  already existed for public databases and manual connections.
- If the VPN is down, a Direct connection fails with `DB_CONNECTION_FAILED` (timeout or
  refused). Its checklist now says to connect the VPN or switch to an SSM tunnel.
