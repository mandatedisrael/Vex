# Security Policy

Vex is self-custodial software that holds users' own keys and can move real
funds. We take security reports seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Do not open a public issue for security bugs.**

Email **security@projectvex.ai** with:

- a description of the issue and its impact;
- steps to reproduce (proof-of-concept if possible);
- affected version or commit and platform;
- any suggested remediation.

If you need to share sensitive details, ask for our PGP key in your first
message.

We aim to acknowledge reports within 3 business days and to keep you updated as
we investigate. Please give us reasonable time to ship a fix before any public
disclosure.

## In scope

- Key generation, storage, and at-rest encryption (vault, keystores, backups).
- Approval gating and any path that could move funds without explicit consent.
- The Electron trust boundary (renderer to privileged process, IPC, preload).
- The auto-updater and release or signing integrity.
- Leakage of keys, seeds, or secrets through logs, telemetry, or crash reports.

## Out of scope

- Loss of funds due to a user-chosen weak master password, lost password, or
  approving a malicious transaction.
- Phishing, impersonation, or software obtained from unofficial sources (see the
  official channels in the README).
- Issues in third-party dependencies already tracked upstream, unless Vex uses
  them in a uniquely unsafe way.

## Safe harbor

We will not pursue or support legal action against good-faith security research
that respects this policy, avoids privacy violations and data destruction, and
does not degrade the service for others.

Official sources: https://www.projectvex.ai/ and https://x.com/ProjectVEXai
