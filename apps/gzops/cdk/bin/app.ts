import * as cdk from 'aws-cdk-lib';
import { WebappStack } from '../lib/webapp-stack.js';

const app = new cdk.App();

// Scaffolding replaces the {{...}} placeholders; the fallbacks keep the
// unscaffolded skeleton synthesizable so CI can validate it.
const isPlaceholder = (v: string) => v.startsWith('{{');
const appName = isPlaceholder('gzops') ? 'unscaffolded-template' : 'gzops';
const appNamePascal = isPlaceholder('Gzops') ? 'UnscaffoldedTemplate' : 'Gzops';
const stage = (app.node.tryGetContext('stage') as string) || 'dev';
const account = (app.node.tryGetContext('account') as string) || '336507940372';
const seedAdminEmail = (app.node.tryGetContext('seedAdminEmail') as string) || 'astout@bioliteenergy.com';
const domainName = app.node.tryGetContext('domainName') as string | undefined;
const certificateArn = app.node.tryGetContext('certificateArn') as string | undefined;

new WebappStack(app, `GzWeb-${appNamePascal}-${stage}`, {
  env: { account, region: 'us-east-1' },
  appName,
  stage,
  seedAdminEmail,
  domainName,
  certificateArn,
});
