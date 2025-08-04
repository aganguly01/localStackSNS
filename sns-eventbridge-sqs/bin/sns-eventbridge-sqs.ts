#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SnsEventbridgeSqsStack } from '../lib/sns-eventbridge-sqs-stack';

const app = new cdk.App();

new SnsEventbridgeSqsStack(app, 'SnsEventbridgeSqsStack', {
  env: {
    account: '000000000000',  // <- Dummy account for LocalStack
    region: 'us-east-1',      // <- Must match your LocalStack region
  }
});

