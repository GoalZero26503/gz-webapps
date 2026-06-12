# /gz:webapp:status — App status report

Report the state of an app in the monorepo. If the user doesn't say which app,
list `apps/` (excluding `_`-prefixed skeletons) and ask.

## Checks

1. **Placeholders**: `grep -rn '{{' apps/<name>/ --include='*.ts' --include='*.eta' --include='*.json' --include='*.md'`
   — unreplaced `{{...}}` means scaffolding isn't finished.
2. **Workspace health**: `pnpm --filter ./apps/<name> typecheck` and `build`.
3. **CODEOWNERS**: does `.github/CODEOWNERS` have an `apps/<name>/` entry?
4. **Deployment** (read-only, gatekeepers' machines only):
   - Stack: `aws cloudformation describe-stacks --stack-name GzWeb-<Pascal>-<stage> --profile gz-<stage>`
   - Outputs of interest: `DistributionDomain`, `FunctionUrl`, `DsqlEndpoint`
   - SSM params present? `aws ssm get-parameters-by-path --path /gzweb/<name>/<stage> --profile gz-<stage>`
5. **Recent deploys**: latest runs of the Deploy workflow for this app
   (`gh run list --workflow deploy.yml`).

## Output

A short table: scaffold status, typecheck/build, CODEOWNERS, per-stage
deployment (stack exists? domain? last deploy), and any action items. Don't
attempt fixes from this command — report, and let the user decide.
