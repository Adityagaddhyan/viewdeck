# Security policy

ViewDeck connects to databases and cloud accounts, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub:
**Security → Report a vulnerability** on this repository
([private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Include what you found, how to reproduce it, and the impact. You'll get an
acknowledgement within a few days, and a fix or mitigation plan once it's confirmed.

## Scope

Especially relevant: anything that could leak credentials or data (stored passwords,
AWS credentials, IAM tokens), bypass the read-only lock or the staged-edit review,
weaken TLS verification, break the renderer sandbox / IPC boundary, or leave orphaned
SSM tunnel processes. See [ARCHITECTURE.md](ARCHITECTURE.md) for the security model.

## Supported versions

Only the latest `main` is supported.
