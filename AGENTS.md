# PRISM development and publication

- Treat `what20360/prism` on GitHub, branch `main`, as the canonical source.
- Read `docs/requirements.md`, `docs/balance.md` and the relevant architecture notes before changing behavior. Keep `src/core/` isolated and deterministic.
- The private test Site is identified by `.openai/hosting.json`. Reuse that exact Site and preserve its audience; do not create another Site for routine changes.
- Unless the user requests local-only work, complete each implementation task by updating both GitHub and the private Site. Follow the Sites skill for credentials, source preparation, packaging and publication.
- Check GitHub's current head before editing. Reconcile external changes before publishing so the Site never silently replaces newer GitHub code.
- Run the relevant tests and `npm run build`, then commit the canonical changes to GitHub. Copy that exact source snapshot into the opened Sites checkout, retaining its Git metadata and Site identity. Remove stale canonical source files when the upstream snapshot deleted them.
- In the Sites checkout only, write `.openai/source.json` with `repository`, `branch` and `commit_sha` for the canonical GitHub commit. Commit this metadata to the Sites source repository through the source helper. Do not copy an old value back to GitHub or put credentials in it.
- Package and push the same source state that was built. If native push publication is not accepted, explicitly save and deploy the matching version. Wait for successful publication before reporting the Site as updated.
- `version.json` in the build output identifies the GitHub revision. Check it against the intended commit when diagnosing synchronization.
- This workflow synchronizes changes made during a development task. Direct pushes to GitHub do not currently trigger an unattended Sites deployment; do not claim that a permanent GitHub webhook or background watcher exists.

See `docs/deployment.md` for the persistent Site and source mapping.
