# Security Policy

## Reporting a vulnerability

Please report security issues privately, not as a public GitHub issue.

- **Preferred:** [open a private security advisory](https://github.com/Vocametrix/vocametrix-mcp/security/advisories/new) on this repository.
- **Email:** info@vocametrix.com

Please include enough detail to reproduce the issue — the affected file and
line, the call path, and a proof of concept if you have one. Do not test against
the hosted Vocametrix server or the production backend; a local reproduction, or
a stubbed one, is what we need and is what we will ask for otherwise.

## What to expect

- Acknowledgement within 3 working days.
- An assessment, with our severity rating and reasoning, within 10 working days.
- A fix released, and the advisory published, before any public disclosure.

We will credit you in the advisory and in the release notes unless you prefer
otherwise. We have no bug bounty programme.

## Scope

In scope: this MCP server (`@vocametrix/mcp-server`), its hosted HTTP endpoint,
and the tool surface it exposes.

Out of scope, and to be reported the same way rather than to this repository:
the Vocametrix API at `platform.vocametrix.com` and the web application at
`vocametrix.com`.

## Supported versions

Only the latest published version of `@vocametrix/mcp-server` receives security
fixes.
