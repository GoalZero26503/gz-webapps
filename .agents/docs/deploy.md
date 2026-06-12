# Deployment

**There are no local deploys.** Deployment happens exclusively via
`.github/workflows/deploy.yml` on merge to `main` (charter §4.5). Developer
machines never hold AWS write credentials; `pnpm synth` / `pnpm diff` are the
only local infrastructure commands.

## Pipeline

1. PR merges to `main`.
2. `deploy.yml` detects which `apps/<name>/` paths changed (underscore-prefixed
   skeletons are never deployed).
3. Per-app matrix job runs with `environment: <app-name>`; the GitHub
   Environment holds `DEPLOY_ROLE_ARN`, and the role's OIDC trust policy is
   keyed to this repo + `main` + that environment claim — app A's job cannot
   assume app B's role.
4. `cdk deploy -c stage=prod` builds the Docker image (Lambda Web Adapter
   container) and updates the stack.
5. Schema migrations: fetch `DsqlEndpoint` from stack outputs, mint an IAM
   auth token (`aws dsql generate-db-connect-admin-auth-token`), `pnpm db:push`.

Manual deploys to dev: `workflow_dispatch` on the Deploy workflow with
app + stage inputs (gatekeepers only — environment protection applies).

## Stack contents (`apps/<name>/cdk/lib/webapp-stack.ts`)

| Resource | Notes |
|---|---|
| `dsql.CfnCluster` | deletion protection in prod; endpoint exported as output |
| `DockerImageFunction` | ARM64, 512 MB, built from repo root with `APP_DIR` build arg |
| Function URL | auth NONE; public entry is CloudFront, not this URL |
| CloudFront Distribution | default behavior → Function URL (no cache); `/assets/*` + `/vendor/*` cached |
| IAM | `dsql:DbConnectAdmin` on the cluster; `ssm:GetParameter` on `/gzweb/{app}/{stage}/*` |

Stack name: `GzWeb-{AppPascal}-{stage}`. All resources tagged
`gz:namespace=gzweb`, `gz:app`, `gz:stage`.

## Per-app one-time setup (gatekeeper, after the app's first PR merges)

1. **GitHub Environment** named `<app-name>`; set `DEPLOY_ROLE_ARN` variable.
2. **Deploy role** `gzweb-deploy-<app-name>` in the target account, trust
   policy scoped to `repo:GoalZero26503/gz-webapps`, `ref:refs/heads/main`,
   and the environment claim; permissions = CDK bootstrap role assumption +
   `dsql:DbConnectAdmin` for migrations.
3. **Google OAuth client** (see auth.md) and **SSM parameters**:
   `/gzweb/<app>/<stage>/jwt_secret` (SecureString, random 64 chars),
   `google_client_id`, `google_client_secret` (SecureString).
4. **First deploy bootstrap**: the first deploy has no custom domain, so
   OAuth needs the CloudFront domain — after deploy one, redeploy with
   `-c baseUrl=https://<DistributionDomain>` (or set up the custom domain
   and `-c domainName=... -c certificateArn=...` right away).
5. **Custom domain**: `<app>.goalzeroapp.com` / `<app>.bioliteapp.com`
   (`<app>-<stage>.` for non-prod) — ACM cert in us-east-1, DNS CNAME to the
   distribution domain.

## Stages & accounts

Default stages are `dev` and `prod`. Each stage deploys to its own AWS
account (profiles `gz-dev` … `gz-prod`; see `docs/environments.md` for the
account table). Region: us-east-1.

## Observability

CloudWatch logs under the function name `gzweb-{stage}-{app}-app` (Fastify
pino JSON logs). Cold-start expectation per the charter: ~600 ms–1.4 s on
<1% of invocations.
