import * as cdk from 'aws-cdk-lib';
import { WebappStack } from '../lib/webapp-stack.js';

const app = new cdk.App();

const stage = (app.node.tryGetContext('stage') as string) || 'dev';
const account = (app.node.tryGetContext('account') as string) || '336507940372';
const seedAdminEmail = (app.node.tryGetContext('seedAdminEmail') as string) || 'astout@bioliteenergy.com';

// Custom domain: gzops2-dev.goalzeroapp.com (dev) / gzops2.goalzeroapp.com (prod).
// The cert + alias records are only created when -c hostedZoneId=Z... is passed
// (by the deploy workflow), so a credential-free `cdk synth` needs no lookup.
const hostedZoneName = (app.node.tryGetContext('hostedZoneName') as string) || 'goalzeroapp.com';
const hostedZoneId = app.node.tryGetContext('hostedZoneId') as string | undefined;
// Wildcard *.goalzeroapp.com cert is in gz-dev us-east-1; the zone is in gz-prod,
// so we import the cert and manage the alias A-record in prod separately. This
// default lets CI's `cdk deploy -c stage=dev` attach the domain automatically.
const certArn =
  (app.node.tryGetContext('certArn') as string) ||
  (stage === 'dev' ? 'arn:aws:acm:us-east-1:336507940372:certificate/4879fd85-38fe-45c5-8381-7feed27db266' : undefined);
const domainName = (app.node.tryGetContext('domainName') as string) || (stage === 'prod' ? 'gzops2.goalzeroapp.com' : `gzops2-${stage}.goalzeroapp.com`);

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
