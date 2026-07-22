# BaudBound Editor

This repository contains the visual editor at [editor.baudbound.app](https://editor.baudbound.app).

## Development

    pnpm install
    pnpm dev

Run the release checks before opening a pull request.

    pnpm lint
    pnpm typecheck
    pnpm schemas:check
    pnpm test
    pnpm build

The files under `contracts/` are a pinned, vendored snapshot of [BaudBound/contracts](https://github.com/BaudBound/contracts). Read `contracts/README.md` before changing package or node contracts.
