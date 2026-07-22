# Vendored contracts

These files are a pinned snapshot of [BaudBound/contracts](https://github.com/BaudBound/contracts).

The editor owns node definitions and generates the node schemas and runner-facing JSON contracts. Contract updates must be reviewed in the contracts repository and then vendored into both the editor and runner repositories in the same compatibility change.

Builds use this checked-in snapshot so they remain reproducible and do not depend on network access.
