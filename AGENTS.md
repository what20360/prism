# PRISM development and publication

- Treat `what20360/prism` on GitHub, branch `main`, as the canonical source.
- Read `docs/requirements.md`, `docs/balance.md` and the relevant architecture notes before changing behavior. Keep `src/core/` isolated and deterministic.
- Complete implementation tasks by updating GitHub only. The user stopped Site maintenance on 2026-10-30; do not start preview servers, synchronize Site source, or deploy unless the user explicitly requests it again.
- Check GitHub's current head before editing. Reconcile external changes before updating `main`.
- Run the relevant tests and `npm run build`, then commit the canonical changes to GitHub.
- Keep existing Site identity and audience metadata intact. Do not commit the checkout-local `.openai/source.json` to GitHub or put credentials in source files.

See `docs/deployment.md` for the persistent Site and source mapping.
