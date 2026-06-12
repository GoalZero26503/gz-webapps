import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dsql from 'aws-cdk-lib/aws-dsql';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';

export interface WebappStackProps extends cdk.StackProps {
  appName: string;
  stage: string;
  seedAdminEmail: string;
  /** Custom domain, e.g. myapp.goalzeroapp.com. Optional on first deploy. */
  domainName?: string;
  /** us-east-1 ACM certificate for the custom domain. */
  certificateArn?: string;
}

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.join(appDir, '..', '..');

export class WebappStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebappStackProps) {
    super(scope, id, props);
    const { appName, stage, seedAdminEmail, domainName, certificateArn } = props;

    // gzweb namespace tags — IAM access for webapp operators is scoped to these
    cdk.Tags.of(this).add('gz:namespace', 'gzweb');
    cdk.Tags.of(this).add('gz:app', appName);
    cdk.Tags.of(this).add('gz:stage', stage);

    // ── Aurora DSQL ─────────────────────────────────────────────
    const cluster = new dsql.CfnCluster(this, 'Database', {
      deletionProtectionEnabled: stage === 'prod',
      tags: [{ key: 'Name', value: `gzweb-${stage}-${appName}` }],
    });
    const dsqlEndpoint = `${cluster.attrIdentifier}.dsql.${this.region}.on.aws`;

    // ── Fastify app: Lambda container + Web Adapter ─────────────
    // APP_BASE_URL must be the user-facing origin for OAuth redirects. Until
    // a custom domain exists, deploy once, then redeploy with
    // -c baseUrl=https://<distribution-domain>.
    const baseUrlOverride = this.node.tryGetContext('baseUrl') as string | undefined;
    const fn = new lambda.DockerImageFunction(this, 'AppFn', {
      functionName: `gzweb-${stage}-${appName}-app`,
      code: lambda.DockerImageCode.fromImageAsset(repoRoot, {
        file: path.join(path.relative(repoRoot, appDir), 'Dockerfile'),
        buildArgs: { APP_DIR: path.relative(repoRoot, appDir) },
        platform: Platform.LINUX_ARM64,
      }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        APP_NAME: appName,
        STAGE: stage,
        DSQL_ENDPOINT: dsqlEndpoint,
        SEED_ADMIN_EMAIL: seedAdminEmail,
        ALLOWED_DOMAINS: 'bioliteenergy.com',
        ...(baseUrlOverride || domainName
          ? { APP_BASE_URL: baseUrlOverride ?? `https://${domainName}` }
          : {}),
      },
    });

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dsql:DbConnectAdmin'],
        resources: [`arn:aws:dsql:${this.region}:${this.account}:cluster/${cluster.attrIdentifier}`],
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/gzweb/${appName}/${stage}/*`],
      }),
    );

    const fnUrl = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    // ── CloudFront: single user-facing origin ───────────────────
    const appOrigin = new origins.FunctionUrlOrigin(fnUrl);
    const certificate = certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'DomainCert', certificateArn)
      : undefined;

    const staticBehavior: cloudfront.BehaviorOptions = {
      origin: appOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    };

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: appOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      additionalBehaviors: {
        '/assets/*': staticBehavior,
        '/vendor/*': staticBehavior,
      },
      ...(domainName && certificate ? { domainNames: [domainName], certificate } : {}),
    });

    // ── Outputs ─────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'FunctionUrl', { value: fnUrl.url });
    new cdk.CfnOutput(this, 'DsqlEndpoint', { value: dsqlEndpoint });
  }
}
