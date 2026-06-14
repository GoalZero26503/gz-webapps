import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';

export interface WebappStackProps extends cdk.StackProps {
  appName: string;
  stage: string;
  seedAdminEmail: string;
  /** gzops-platform API origin the BFF signs requests to. */
  platformBaseUrl: string;
  /**
   * execute-api ARNs the Lambda role may invoke (gzops-platform api-stack +
   * deployment-stack). Defaults to all APIs in this account/region — narrow to
   * the two gzops-platform API IDs once confirmed (least privilege).
   */
  platformApiArns?: string[];
  /** Custom domain, e.g. gzops2-dev.goalzeroapp.com. */
  domainName?: string;
  /** Route53 hosted zone that owns domainName, e.g. goalzeroapp.com. */
  hostedZoneName?: string;
  /**
   * Hosted zone ID for domainName. Domain resources (ACM cert + alias records)
   * are only created when this is supplied — passed by the deploy workflow so a
   * credential-free `cdk synth` (PR validation) needs no Route53 lookup.
   */
  hostedZoneId?: string;
  /**
   * Imported ACM cert ARN (us-east-1) covering domainName — used when the
   * Route53 zone lives in another account (e.g. *.goalzeroapp.com in gz-prod).
   * When set, the domain attaches to CloudFront but NO in-account DNS record is
   * created; the alias record is managed in the owning account separately.
   */
  certArn?: string;
}

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.join(appDir, '..', '..');

// App-owned KV tables (charter §3.5 escape hatch). Suffix → partition key.
// Names resolve to gzweb-{stage}-{app}-{suffix}; must match store/client.ts.
const TABLES: Record<string, string> = {
  Users: 'email',
  Requests: 'id',
  Notifications: 'id',
  Programs: 'id',
  AccessLog: 'id',
};

export class WebappStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebappStackProps) {
    super(scope, id, props);
    const { appName, stage, seedAdminEmail, platformBaseUrl, hostedZoneName, hostedZoneId, certArn } = props;
    // Domain is active when we can attach a cert: an imported ARN (cross-account
    // zone) or an in-account hosted zone. Gated so credential-free synth works.
    const domainName = (certArn || hostedZoneId) ? props.domainName : undefined;
    const tablePrefix = `gzweb-${stage}-${appName}-`;

    // gzweb namespace tags — IAM access for webapp operators is scoped to these
    cdk.Tags.of(this).add('gz:namespace', 'gzweb');
    cdk.Tags.of(this).add('gz:app', appName);
    cdk.Tags.of(this).add('gz:stage', stage);

    // ── App-owned DynamoDB tables ───────────────────────────────
    const tables = Object.entries(TABLES).map(([suffix, key]) =>
      new dynamodb.Table(this, `Table${suffix}`, {
        tableName: `${tablePrefix}${suffix}`,
        partitionKey: { name: key, type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
    );

    // ── Custom domain (ACM us-east-1 + Route53) ─────────────────
    let certificate: acm.ICertificate | undefined;
    let hostedZone: route53.IHostedZone | undefined;
    if (domainName && certArn) {
      // Imported cert (e.g. *.goalzeroapp.com in gz-dev us-east-1). The zone is
      // cross-account, so no Route53 records are created here.
      certificate = acm.Certificate.fromCertificateArn(this, 'DomainCert', certArn);
    } else if (domainName && hostedZoneId && hostedZoneName) {
      // fromHostedZoneAttributes (not fromLookup) — no AWS call, so synth works
      // without credentials.
      hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', { hostedZoneId, zoneName: hostedZoneName });
      // Stack is in us-east-1, so this cert is valid for CloudFront directly.
      certificate = new acm.Certificate(this, 'DomainCert', {
        domainName,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
    }

    // ── Fastify app: Lambda container + Web Adapter ─────────────
    // APP_BASE_URL must be the user-facing origin for OAuth redirects. Without a
    // custom domain, deploy once then redeploy with -c baseUrl=https://<cf-domain>.
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
        SEED_ADMIN_EMAIL: seedAdminEmail,
        ALLOWED_DOMAINS: 'bioliteenergy.com',
        STORE_MODE: 'dynamo',
        TABLE_PREFIX: tablePrefix,
        PLATFORM_MODE: 'live',
        PLATFORM_BASE_URL: platformBaseUrl,
        // Lambda Web Adapter response streaming — required for the SSE route to
        // stream instead of buffer (see routes/deploy.ts).
        AWS_LWA_INVOKE_MODE: 'response_stream',
        ...(baseUrlOverride || domainName ? { APP_BASE_URL: baseUrlOverride ?? `https://${domainName}` } : {}),
      },
    });

    for (const t of tables) t.grantReadWriteData(fn);

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/gzweb/${appName}/${stage}/*`],
      }),
    );
    // BFF → gzops-platform API (SigV4). The browser never calls the platform.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:Invoke'],
        resources: props.platformApiArns ?? [`arn:aws:execute-api:${this.region}:${this.account}:*`],
      }),
    );

    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    // ── CloudFront: single user-facing origin ───────────────────
    const appOrigin = new origins.FunctionUrlOrigin(fnUrl);

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
        // Root-level static assets — without these they fall under the default
        // (CACHING_DISABLED) behavior and hit the Lambda on every page load.
        '/styles.css': staticBehavior,
        '/favicon.ico': staticBehavior,
      },
      ...(domainName && certificate ? { domainNames: [domainName], certificate } : {}),
    });

    if (domainName && hostedZone) {
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
      new route53.ARecord(this, 'AliasA', { zone: hostedZone, recordName: domainName, target });
      new route53.AaaaRecord(this, 'AliasAAAA', { zone: hostedZone, recordName: domainName, target });
    }

    // ── Outputs ─────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'FunctionUrl', { value: fnUrl.url });
    if (domainName) new cdk.CfnOutput(this, 'AppUrl', { value: `https://${domainName}` });
  }
}
