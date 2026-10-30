# PRISM development and publication

- Treat `what20360/prism` on GitHub, branch `main`, as the canonical source.
- Read `docs/requirements.md`, `docs/balance.md` and the relevant architecture notes before changing behavior. Keep `src/core/` isolated and deterministic.
- Complete implementation tasks by updating GitHub. The repository's GitHub Actions workflow builds and publishes GitHub Pages from `main` once Pages has been enabled; check its result when available.
- The user stopped maintenance of the old Site and local preview on 2026-10-30. Do not restart preview servers, synchronize old Site source, or deploy to the old Site unless explicitly requested.
- Check GitHub's current head before editing. Reconcile external changes before updating `main`.
- Run the relevant tests and `npm run build`, then commit the canonical changes to GitHub.
- Keep existing Site identity and audience metadata intact. Do not commit the checkout-local `.openai/source.json` to GitHub or put credentials in source files.

See `docs/deployment.md` for GitHub Pages setup and delivery details.
