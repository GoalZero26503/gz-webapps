import * as cdk from 'aws-cdk-lib';
import { WebappStack } from '../lib/webapp-stack.js';

const app = new cdk.App();

const stage = (app.node.tryGetContext('stage') as string) || 'dev';
const account = (app.node.tryGetContext('account') as string) || '336507940372';
const seedAdminEmail = (app.node.tryGetContext('seedAdminEmail') as string) || 'astout@bioliteenergy.com';

// Custom domain: gzops2-dev.goalzeroapp.com (dev) / gzops2.goalzeroapp.com (prod).
// Pass -c domainName='' to deploy without one (first bootstrap deploy).
const hostedZoneName = (app.node.tryGetContext('hostedZoneName') as string) || 'goalzeroapp.com';
const domainDefault = stage === 'prod' ? 'gzops2.goalzeroapp.com' : `gzops2-${stage}.goalzeroapp.com`;
const domainCtx = app.node.tryGetContext('domainName') as string | undefined;
const domainName = domainCtx === '' ? undefined : (domainCtx ?? domainDefault);

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
});
