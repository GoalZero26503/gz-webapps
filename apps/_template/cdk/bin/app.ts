import * as cdk from 'aws-cdk-lib';
import { WebappStack } from '../lib/webapp-stack.js';

const app = new cdk.App();

// Scaffolding replaces the {{...}} placeholders; the fallbacks keep the
// unscaffolded skeleton synthesizable so CI can validate it.
const isPlaceholder = (v: string) => v.startsWith('{{');
const appName = isPlaceholder('{{APP_NAME}}') ? 'unscaffolded-template' : '{{APP_NAME}}';
const appNamePascal = isPlaceholder('{{APP_NAME_PASCAL}}') ? 'UnscaffoldedTemplate' : '{{APP_NAME_PASCAL}}';
const stage = (app.node.tryGetContext('stage') as string) || 'dev';
const account = (app.node.tryGetContext('account') as string) || '336507940372';
const seedAdminEmail = (app.node.tryGetContext('seedAdminEmail') as string) || '{{SEED_ADMIN_EMAIL}}';
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
