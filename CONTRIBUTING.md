# Contributing

Thanks for your interest in Innospace Scheduler.

## Licensing of contributions

This project is licensed under the [Apache License 2.0](LICENSE). Unless you
state otherwise, any contribution you submit for inclusion is licensed under
those same terms (Apache 2.0, Section 5). Inbound equals outbound: no separate
CLA to sign.

Note the [trademark policy](TRADEMARK.md): the code is open, but the name and
InnoSpace branding are reserved. Contributions must not add code that reuses the
marks in a way the policy forbids.

## Before you open a PR

Run the full gate locally and make sure it passes:

```
make check
```

That runs formatting, lint, type-checking, and the test suite. `make fmt`
auto-fixes formatting and lint.

- Do not run `npm run build` during development: it writes to the same `.next`
  directory as the running dev server.
- Add or update tests for behaviour you change. Tests live in `tests/` and never
  touch a real database or send real email.
- Keep comments short and focused on the non-obvious why.

## Reporting bugs and requesting features

Open an issue with steps to reproduce (for bugs) or a clear use case (for
features). For anything security-related, follow [SECURITY.md](SECURITY.md)
instead of filing a public issue.
