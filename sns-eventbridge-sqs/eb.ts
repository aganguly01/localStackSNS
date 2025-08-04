// File: lib/sns-eventbridge-sqs-stack.ts
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';

export class SnsEventBridgeSqsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. SNS Topic - Source of events
    const topic = new sns.Topic(this, 'SourceSNSTopic');

    // 2. SQS Queue - Destination
    const destinationQueue = new sqs.Queue(this, 'DestinationQueue', {
      visibilityTimeout: Duration.seconds(30),
    });

    // 3. Custom Event Bus
    const eventBus = new events.EventBus(this, 'CustomEventBus', {
      eventBusName: 'JsonConversionBus'
    });

    // 4. Grant permissions for SNS to EventBridge (for testing only; EventBridge doesn't directly subscribe to SNS)
    topic.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['SNS:Publish'],
      principals: [new iam.ServicePrincipal('sns.amazonaws.com')],
      resources: [topic.topicArn],
    }));

    // 5. EventBridge Rule that matches all events from the topic via custom source
    new events.Rule(this, 'TransformAndRouteRule', {
      eventBus,
      eventPattern: {
        source: ['custom.source'],
      },
      targets: [
        new targets.SqsQueue(destinationQueue, {
          message: events.RuleTargetInput.fromObject({
            transformedField: events.EventField.fromPath('$.detail.originalField'),
            constantField: 'staticValue',
          })
        })
      ]
    });

    // 6. Sample usage note: to test, you must manually publish an event to EventBridge
    // using the AWS Console or SDK with source 'custom.source' and some JSON detail
  }
}

