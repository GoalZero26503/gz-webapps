import * as cdk from 'aws-cdk-lib';
import { WebappStack } from '../lib/webapp-stack.js';

const app = new cdk.App();

const stage = (app.node.tryGetContext('stage') as string) || 'dev';
// Account is stage-derived (gz-dev / gz-prod) so the workflow's `cdk deploy -c
// stage=prod` targets the right account without an extra context flag, and the
// Lambda's execute-api / SSM ARNs (this.account) scope to the correct platform.
const account =
  (app.node.tryGetContext('account') as string) ||
  (stage === 'prod' ? '520397908078' : '336507940372');
const seedAdminEmail = (app.node.tryGetContext('seedAdminEmail') as string) || 'astout@bioliteenergy.com';

// Custom domain: gzops2-dev.goalzeroapp.com (dev) / gzops.goalzeroapp.com (prod).
// The cert + alias records are only created when -c hostedZoneId=Z... is passed
// (by the deploy workflow), so a credential-free `cdk synth` needs no lookup.
const hostedZoneName = (app.node.tryGetContext('hostedZoneName') as string) || 'goalzeroapp.com';
const hostedZoneId = app.node.tryGetContext('hostedZoneId') as string | undefined;
// CloudFront requires the ACM cert to live in the SAME account as the distribution
// (us-east-1). The *.goalzeroapp.com wildcard exists in both gz-dev and gz-prod, so
// each stage's default points at its own account's wildcard. The goalzeroapp.com
// Route53 zone is in gz-prod: prod deploys in-account so CI can create the alias
// (pass -c hostedZoneId=...); dev deploys cross-account so its alias is managed
// separately.
const certArn =
  (app.node.tryGetContext('certArn') as string) ||
  (stage === 'prod'
    ? 'arn:aws:acm:us-east-1:520397908078:certificate/ccb72120-ca5d-4a97-8bb3-2c1903727217'
    : 'arn:aws:acm:us-east-1:336507940372:certificate/4879fd85-38fe-45c5-8381-7feed27db266');
const domainName = (app.node.tryGetContext('domainName') as string) || (stage === 'prod' ? 'gzops.goalzeroapp.com' : `gzops2-${stage}.goalzeroapp.com`);

const platformBaseUrl =
  (app.node.tryGetContext('platformBaseUrl') as string) ||
  (stage === 'prod' ? 'https://gzops-api.goalzeroapp.com' : `https://gzops-api-${stage}.goalzeroapp.com`);

new WebappStack(app, `GzWeb-Gzops-${stage}`, {
  env: { account, region: 'us-east-1' },
  appName: 'gzops',
  stage,
  seedAdminEmail,
  platformBaseUrl,
  domainName,
  hostedZoneName,
  hostedZoneId,
  certArn,
});
