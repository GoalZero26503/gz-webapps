# Environments

## Default stages

| Stage | Purpose | Deployed by |
|-------|---------|-------------|
| **dev** | Development and testing | Deploy workflow, manual dispatch |
| **prod** | Real users | Merge to `main` (automatic) |

Most internal apps only need these two. Each stage is a completely separate
CloudFormation stack — its own Lambda container, DSQL cluster, CloudFront
distribution, and SSM parameters — in a different AWS account, so dev can
never affect prod.

## AWS account mapping

| Stage | AWS Profile | Account ID |
|-------|-------------|------------|
| dev | gz-dev | 336507940372 |
| test | gz-test | 027165054099 |
| alpha | gz-alpha | 083837808427 |
| beta | gz-beta | 943878440428 |
| stage | gz-stage | 678658412915 |
| prod | gz-prod | 520397908078 |

Region is always us-east-1. (Profiles are for gatekeeper read/debug access —
deploys go through CI; see `.agents/docs/deploy.md`.)

## Domains

| Stage | Pattern | Example |
|-------|---------|---------|
| prod | `{app}.goalzeroapp.com` | `fleet-tracker.goalzeroapp.com` |
| others | `{app}-{stage}.goalzeroapp.com` | `fleet-tracker-dev.goalzeroapp.com` |

BioLite-owned apps use `bioliteapp.com` with the same pattern.

## Idle cost

The point of this stack (charter §5): an idle app costs ~$0/mo. Lambda and
DSQL scale to zero; CloudFront and SSM standard parameters are free at this
scale. Adding a stage costs nothing while it's unused — but delete stages
that are truly dead anyway (stacks accumulate operational surface).

## Adding a stage

1. Gatekeeper: SSM parameters + Google OAuth redirect URI for the new stage
   (see `docs/setup.md` steps 3–4).
2. Deploy via workflow_dispatch with the new stage input.
3. (If exposed to users) custom domain + certificate.

The CDK app takes the stage from `-c stage=...`; no code changes needed.
