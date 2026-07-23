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

The `contracts/` submodule points to one reviewed commit from [BaudBound/contracts](https://github.com/BaudBound/contracts). Initialize it after cloning:

    git submodule update --init --recursive

Contract generation modifies the submodule working tree. Contract changes must be committed and reviewed in the contracts repository before the editor updates its submodule reference.
