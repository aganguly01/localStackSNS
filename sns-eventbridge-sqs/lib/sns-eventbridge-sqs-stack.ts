import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as path from 'path';

export class SnsEventbridgeSqsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const topic = new sns.Topic(this, 'SourceSNSTopic', {
      displayName: 'Source SNS Topic',
    });

    const destinationQueue = new sqs.Queue(this, 'DestinationQueue', {
      queueName: 'destination-queue',
    });

    const eventBus = new events.EventBus(this, 'CustomEventBus', {
      eventBusName: 'CustomJsonTransformBus',
    });

    const snsToEventBridgeLambda = new lambda.Function(this, 'SnsToEventBridgeLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda-handler')),
      environment: {
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    eventBus.grantPutEventsTo(snsToEventBridgeLambda);

    topic.addSubscription(new snsSubscriptions.LambdaSubscription(snsToEventBridgeLambda));

    new events.Rule(this, 'EBRuleForwardToSQS', {
      ruleName: 'JsonTransformAndForward',
      eventBus: eventBus,
      eventPattern: {
        source: ['custom.sns.source'],
      },
      targets: [
        new targets.SqsQueue(destinationQueue, {
          message: events.RuleTargetInput.fromObject({
            transformedMessage: events.EventField.fromPath('$.detail'),
	    processedAt: events.EventField.time,
            status: 'processed'
          }),
        }),
      ],
    });
  }
}

