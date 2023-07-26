#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SupplyFunnelStack } from '../lib/supply-funnel-stack';

const app = new cdk.App();
new SupplyFunnelStack(app, 'SupplyFunnelStack', {
	environmentName: 'dev',
	env: { account: '123456789012', region: 'us-east-1' }
});
