/**
 * Fake-mode platform data — served by the BFF client when PLATFORM_MODE=fake
 * (local dev). Ported from the UI prototype (`ui-prototype/js/data.js`) so the
 * app is fully explorable without AWS credentials or a live platform API.
 */
import type { Deployment, Project } from './types.js';

const ago = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const FIXTURE_PROJECTS: Project[] = [
  {
    id: 'yeti-pro-4000-kit',
    name: 'Yeti PRO 4000 Kit',
    type: 'firmware-kit',
    repo: 'GoalZero26503/yeti-6g-firmware',
    components: [
      { label: 'PCU', projectId: 'pcu-firmware' },
      { label: 'WMU', projectId: 'wmu-firmware' },
      { label: 'MPPT', projectId: 'mppt-firmware' },
      { label: 'BMS', projectId: 'bms-firmware' },
      { label: 'Inverter', projectId: 'inverter-firmware' },
    ],
    channels: {
      App: { dev: { v: 'v0.4.12-rc1', age: '4m', state: 'live' }, test: { v: 'v0.4.11', age: '2d', state: 'live' }, alpha: { v: 'v0.4.10', state: 'deploying', progress: 38 }, beta: { v: 'v0.3.5', age: '11d', state: 'live' }, stage: { v: 'v0.3.5', age: '11d', state: 'live' }, prod: { v: 'v0.3.2', age: '32d', state: 'live' } },
      Warehouse: { dev: { v: 'v0.4.0', age: '8d', state: 'live' }, test: null, alpha: null, beta: null, stage: null, prod: { v: 'v0.2.14', age: '60d', state: 'live' } },
      Manual: { dev: null, test: { v: 'v0.4.9', age: '5d', state: 'live' }, alpha: null, beta: null, stage: null, prod: null },
    },
    rail: { dev: { v: 'v0.4.12-rc1', age: '4m', state: 'live' }, test: { v: 'v0.4.11', age: '2d', state: 'live' }, alpha: { v: 'v0.4.10', state: 'deploying', progress: 38 }, beta: { v: 'v0.3.5', age: '11d', state: 'live' }, stage: { v: 'v0.3.5', age: '11d', state: 'live' }, prod: { v: 'v0.3.2', age: '32d', state: 'live' } },
  },
  {
    id: 'bms-firmware', name: 'BMS Firmware', type: 'firmware-node', repo: 'GoalZero26503/yeti-6g-fw-bms-hp',
    rail: { dev: { v: 'v2.1.9', age: '1d', state: 'live' }, test: { v: 'v2.1.8-rc', state: 'failed', note: 'deploy failed 12m ago' }, alpha: { v: 'v2.0.5', age: '20d', state: 'live' }, beta: { v: 'v2.0.5', age: '20d', state: 'live' }, stage: { v: 'v2.0.2', age: '41d', state: 'live' }, prod: { v: 'v2.0.1', age: '55d', state: 'live' } },
  },
  {
    id: 'pcu-firmware', name: 'PCU Firmware', type: 'firmware-node', repo: 'GoalZero26503/yeti-6g-pcu',
    rail: { dev: { v: 'v2.1.4', age: '3d', state: 'live' }, test: { v: 'v2.1.4', age: '3d', state: 'live' }, alpha: { v: 'v2.1.3', age: '9d', state: 'live' }, beta: { v: 'v2.0.8', age: '20d', state: 'live' }, stage: { v: 'v2.0.8', age: '20d', state: 'live' }, prod: { v: 'v2.0.5', age: '40d', state: 'live' } },
  },
  {
    id: 'wmu-firmware', name: 'WMU Firmware', type: 'firmware-node', repo: 'GoalZero26503/yeti-6g-wireless',
    rail: { dev: { v: 'v1.5.1', age: '2d', state: 'live' }, test: { v: 'v1.5.1', age: '2d', state: 'live' }, alpha: { v: 'v1.5.0', age: '10d', state: 'live' }, beta: { v: 'v1.4.6', age: '22d', state: 'live' }, stage: { v: 'v1.4.6', age: '22d', state: 'live' }, prod: { v: 'v1.4.2', age: '45d', state: 'live' } },
  },
  {
    id: 'mppt-firmware', name: 'MPPT Firmware', type: 'firmware-node', repo: 'GoalZero26503/yeti-6g-fw-mppt',
    rail: { dev: { v: 'v0.9.2', age: '5d', state: 'live' }, test: { v: 'v0.9.2', age: '5d', state: 'live' }, alpha: { v: 'v0.9.2', age: '5d', state: 'live' }, beta: { v: 'v0.9.0', age: '25d', state: 'live' }, stage: { v: 'v0.9.0', age: '25d', state: 'live' }, prod: { v: 'v0.8.7', age: '50d', state: 'live' } },
  },
  {
    id: 'inverter-firmware', name: 'Inverter Firmware', type: 'firmware-node', repo: 'GoalZero26503/yeti-6g-fw-inverter',
    rail: { dev: { v: 'v0.2.9', age: '4d', state: 'live' }, test: { v: 'v0.2.9', age: '4d', state: 'live' }, alpha: { v: 'v0.2.8', age: '12d', state: 'live' }, beta: { v: 'v0.2.6', age: '24d', state: 'live' }, stage: { v: 'v0.2.6', age: '24d', state: 'live' }, prod: { v: 'v0.2.4', age: '48d', state: 'live' } },
  },
  {
    id: 'goal-zero-app', name: 'Goal Zero App', type: 'mobile', repo: 'GoalZero26503/yetiapp', promotes: false,
    rail: { dev: { v: 'v5.4.0', b: 812, age: '2d', state: 'live' }, test: { v: 'v5.3.3', b: 798, age: '5d', state: 'live' }, alpha: { v: 'v5.3.1', b: 771, age: '9d', state: 'live' }, beta: { v: 'v5.4.0', b: 810, state: 'deploying', progress: 64, note: 'TestFlight upload' }, stage: { v: 'v5.3.1', b: 771, age: '21d', state: 'live' }, prod: { v: 'v5.2.1', b: 740, age: '30d', state: 'live' } },
    cohorts: {
      TestFlight: [['1. Dev Env', '5.4.0 (812)'], ['2. Test Env', '5.3.3 (798)'], ['GZ Internal', '5.4.0 (810)'], ['Clayton', '5.3.1 (771)']],
      'Play tracks': [['internal', '5.4.0 (812)'], ['PreProd', '5.3.1 (771)'], ['production', '5.2.1 (740)']],
    },
    accessGroups: [{ name: 'Field Testers', published: 'v5.4.0 (812)' }, { name: 'Partner Demo', published: 'v5.3.1 (771)' }],
  },
  {
    id: 'yeti-inspector', name: 'Yeti Inspector', type: 'mobile', repo: 'GoalZero26503/yeti-inspector-mobile-app', promotes: false,
    rail: { dev: { v: 'v0.4.0', b: 14, age: '6h', state: 'live' }, test: null, alpha: null, beta: null, stage: null, prod: { v: 'v0.3.2', b: 9, age: '90d', state: 'live' } },
    cohorts: { TestFlight: [['Internal', '0.4.0 (14)']], 'Play tracks': [['internal', '0.4.0 (14)']] },
    accessGroups: [],
  },
  {
    id: 'iot-cloud-backend', name: 'IoT Cloud Backend', type: 'cloud', repo: 'GoalZero26503/iot-cloud-backend',
    rail: { dev: { v: 'main-head', age: '5m', state: 'live' }, test: { v: 'v3.0.0-rc', age: '2h', state: 'live' }, alpha: { v: 'v2.9.4', age: '9d', state: 'live' }, beta: { v: 'v2.9.4', age: '9d', state: 'live' }, stage: { v: 'v3.0.0-rc', age: '2h', state: 'live' }, prod: { v: 'prod-v2', age: '14d', state: 'live' } },
    health: 'All stacks healthy',
  },
];

export function fixtureDeployments(): Deployment[] {
  return [
    {
      id: 'd-104', projectId: 'goal-zero-app', version: 'v5.4.0 (810)', env: 'beta', pipeline: 'testflight', executor: 'github-workflow', status: 'in_progress', progress: 64, by: 'm.jantzen', at: ago(8 * MIN),
      workflowUrl: 'https://github.com/GoalZero26503/yetiapp/actions/runs/27384551892',
      log: [
        ['12:01:04', 'info', 'Deployment created by m.jantzen — artifact goal-zero-app.ios.beta.v5.4.0.810.d9debc0b.ipa → beta'],
        ['12:01:05', 'info', 'Dispatched DEPLOY_testflight.yml on GoalZero26503/yetiapp (run 27384551892)'],
        ['12:01:41', 'info', 'Runner picked up job (macos-15)'],
        ['12:02:10', 'info', 'Downloaded artifact from gzops storage (6.6 MB, presigned)'],
        ['12:02:55', 'info', 'altool: starting upload to App Store Connect…'],
        ['12:05:12', 'info', 'altool: upload 64% — awaiting Apple processing'],
      ],
    },
    {
      id: 'd-103', projectId: 'bms-firmware', version: 'v2.1.8-rc', env: 'test', pipeline: 'firmware-s3', executor: 'lambda', status: 'failed', by: 'system', at: ago(12 * MIN), note: 'Test suite failed on v2.1.8-rc',
      log: [
        ['11:47:02', 'info', 'Deployment created (auto-promote on green test suite)'],
        ['11:47:02', 'info', 'Resolving artifact bms-firmware.fw-ota.v2.1.8-rc.7f3a92c1.bin'],
        ['11:47:03', 'info', 'Copying image to gz-test-firmware-images…'],
        ['11:47:05', 'error', 'Manifest validation failed: image checksum mismatch for y1k slot (expected 7f3a92c1, got 2ec53ed1)'],
        ['11:47:05', 'error', 'Deploy aborted — environment left unchanged (previous v2.1.4 still live)'],
      ],
    },
    {
      id: 'd-102', projectId: 'yeti-pro-4000-kit', version: 'v0.4.11', env: 'test', pipeline: 'kit-manifest', executor: 'lambda', status: 'succeeded', by: 'astout', at: ago(2 * DAY),
      log: [
        ['09:12:30', 'info', 'Deployment created by astout — kit manifest v0.4.11 → test (App channel)'],
        ['09:12:31', 'info', 'Resolved 5 node images; all checksums verified'],
        ['09:12:33', 'info', 'Wrote manifest to gz-test-firmware-manifests/app/manifest.json'],
        ['09:12:33', 'info', 'Deploy succeeded — fleet will pick up on next check-in'],
      ],
    },
    {
      id: 'd-101', projectId: 'iot-cloud-backend', version: 'v3.0.0-rc', env: 'stage', pipeline: 'github-action', executor: 'github-workflow', status: 'succeeded', by: 'a.smith', at: ago(2 * HOUR),
      workflowUrl: 'https://github.com/GoalZero26503/iot-cloud-backend/actions/runs/27384012345',
      log: [
        ['10:02:11', 'info', 'Dispatched DEPLOY_serverless.yml on GoalZero26503/iot-cloud-backend'],
        ['10:04:48', 'info', 'CloudFormation: UPDATE_IN_PROGRESS (stack iot-cloud-stage)'],
        ['10:09:30', 'info', 'CloudFormation: UPDATE_COMPLETE'],
        ['10:09:31', 'info', 'Callback received — deploy succeeded'],
      ],
    },
    {
      id: 'd-100', projectId: 'goal-zero-app', version: 'v5.2.1 (740)', env: 'prod', pipeline: 'playstore', executor: 'lambda', status: 'succeeded', by: 'astout', at: ago(30 * DAY),
      externalUrl: 'https://play.google.com/console/u/0/developers/app/tracks/production',
      log: [
        ['14:20:01', 'info', 'Deployment created by astout — AAB v5.2.1 (740) → prod (production track)'],
        ['14:20:04', 'info', 'Uploaded AAB to Play Developer API'],
        ['14:20:09', 'info', 'Created release on production track (draft → rolled out)'],
      ],
    },
  ];
}
