# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report privately to **igliihoxha@gmail.com** with:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- affected version or commit.

You will get an acknowledgement, and we will work with you on a fix and
disclosure timeline. Please give us reasonable time to address the issue before
disclosing it publicly.

## Supported versions

This is a single-tenant application deployed from `master`. Security fixes land
on `master`; there are no separately maintained release branches.

## Scope notes for self-hosters

Because you run your own instance, some of the security posture is on you:

- Set strong `AUTH_SECRET`, `DASHBOARD_USERNAME`, and `DASHBOARD_PASSWORD`.
- Keep `.env` secrets out of version control (it is gitignored).
- Serve over HTTPS and set `ALLOWED_ORIGINS` correctly.
- The SQLite database at `DATA_FILE` holds member data: protect the volume and
  its backups.
