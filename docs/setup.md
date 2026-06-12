# Setup Guide

How a new app goes from idea to deployed. Two halves: the **creator** part
(anyone, no AWS access needed) and the **gatekeeper** part (one-time per-app
AWS/GitHub wiring).

## Creator: scaffold and develop

1. **Clone the monorepo** and open it in Claude Code.
2. **Run `/gz:webapp:new-app`** and describe what you want to build. The
   assistant picks the stack (the default fits nearly everything), names the
   app with you, and runs:
   ```bash
   pnpm scaffold <app-name> --display "My App" --owner <your-gh-handle> --admin <your-email>
   pnpm install
   ```
3. **Develop locally** in `apps/<app-name>/`:
   ```bash
   docker run -d --name pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 5432:5432 postgres:16
   cp .env.example .env     # needs a Google OAuth client for full login flow (see below)
   pnpm db:push
   pnpm dev                 # http://localhost:3000
   ```
4. **Open a PR** on a branch named `<gh-username>/<short-description>`. CI
   typechecks, builds, and synths only the apps your PR touches. Both the
   gatekeeper team and (after the first merge) your CODEOWNERS entry must
   approve.

You never need AWS credentials. If a step seems to require them, it's a
gatekeeper step — ask in the PR.

## Gatekeeper: one-time per-app wiring (after first merge)

1. **GitHub Environment** named `<app-name>` with variable `DEPLOY_ROLE_ARN`.
2. **Deploy role** `gzweb-deploy-<app-name>` in the target account:
   - Trust: GitHub OIDC, scoped to `repo:GoalZero26503/gz-webapps`,
     `ref:refs/heads/main`, environment `<app-name>`.
   - Permissions: assume CDK bootstrap roles + `dsql:DbConnectAdmin` (for
     migrations).
3. **Google OAuth client** (Google Cloud Console → Credentials → OAuth client,
   type Web application):
   - Redirect URI `https://<app-domain>/auth/callback`
     (+ `http://localhost:3000/auth/callback` on the dev-stage client).
4. **SSM parameters** (per stage):
   ```bash
   aws ssm put-parameter --profile gz-<stage> --name /gzweb/<app>/<stage>/jwt_secret \
     --type SecureString --value "$(openssl rand -base64 48)"
   aws ssm put-parameter --profile gz-<stage> --name /gzweb/<app>/<stage>/google_client_id \
     --type String --value "<client-id>"
   aws ssm put-parameter --profile gz-<stage> --name /gzweb/<app>/<stage>/google_client_secret \
     --type SecureString --value "<client-secret>"
   ```
5. **First deploy**: run the Deploy workflow (workflow_dispatch, stage `dev`)
   or merge a change. The first deploy outputs `DistributionDomain`.
6. **Base URL**: OAuth needs the app's canonical origin. Either set up the
   custom domain now (ACM cert in us-east-1, CNAME, deploy with
   `-c domainName=<app>.goalzeroapp.com -c certificateArn=...`) or redeploy
   with `-c baseUrl=https://<DistributionDomain>`.
7. **Smoke test**: visit the app, sign in as the seed admin (auto-created on
   first login), invite the creator from `/users`.

## Domains

`<app>.goalzeroapp.com` (GZ) / `<app>.bioliteapp.com` (BL); non-prod stages
use `<app>-<stage>.`. See `docs/environments.md` for accounts and stages.
