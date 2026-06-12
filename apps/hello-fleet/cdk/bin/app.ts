import * as cdk from 'aws-cdk-lib';
import { WebappStack } from '../lib/webapp-stack.js';

const app = new cdk.App();

const appName = 'hello-fleet';
const stage = (app.node.tryGetContext('stage') as string) || 'dev';
const account = (app.node.tryGetContext('account') as string) || '336507940372';
const seedAdminEmail = (app.node.tryGetContext('seedAdminEmail') as string) || 'astout@bioliteenergy.com';
const domainName = app.node.tryGetContext('domainName') as string | undefined;
const certificateArn = app.node.tryGetContext('certificateArn') as string | undefined;

new WebappStack(app, `GzWeb-HelloFleet-${stage}`, {
  env: { account, region: 'us-east-1' },
  appName,
  stage,
  seedAdminEmail,
  domainName,
  certificateArn,
});
