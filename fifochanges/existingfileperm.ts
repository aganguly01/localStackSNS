import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';

export class SnsEventbridgeSqsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //
    // ⚡ If you want to use EXISTING SNS FIFO instead of creating new:
    //
    const topic = sns.Topic.fromTopicArn(this, 'ExistingSNSTopic',
      'arn:aws:sns:us-east-1:747929218943:source-sns-topic.fifo'
    );

    // SQS FIFO Queue (between SNS FIFO and Lambda) – created new
    const snsToLambdaQueue = new sqs.Queue(this, 'SnsToLambdaQueue', {
      queueName: 'sns-to-lambda-queue.fifo',
      fifo: true,
      contentBasedDeduplication: true,
    });

    // 🔑 Add permission for SNS to send messages to this new SQS
    snsToLambdaQueue.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('sns.amazonaws.com')],
      actions: ['sqs:SendMessage'],
      resources: [snsToLambdaQueue.queueArn],
      conditions: {
        ArnEquals: {
          'aws:SourceArn': 'arn:aws:sns:us-east-1:747929218943:source-sns-topic.fifo',
        },
      },
    }));

    // Subscribe the FIFO queue to existing SNS FIFO
    topic.addSubscription(new snsSubscriptions.SqsSubscription(snsToLambdaQueue));

    //
    // ⚡ If you want to use EXISTING destination SQS FIFO:
    //
    const destinationQueue = sqs.Queue.fromQueueArn(this, 'ExistingDestinationQueue',
      'arn:aws:sqs:us-east-1:747929218943:destination-queue.fifo'
    );

    // EventBridge Bus
    const eventBus = new events.EventBus(this, 'CustomEventBus', {
      eventBusName: 'CustomJsonTransformBus',
    });

    // Lambda to process messages from SQS FIFO and forward to EventBridge
    const snsToEventBridgeLambda = new lambda.Function(this, 'SnsToEventBridgeLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda-handler')),
      environment: {
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });

    eventBus.grantPutEventsTo(snsToEventBridgeLambda);

    // Connect Lambda to poll from the FIFO queue
    snsToEventBridgeLambda.addEventSourceMapping('SnsToLambdaQueueMapping', {
      eventSourceArn: snsToLambdaQueue.queueArn,
      batchSize: 1, // FIFO → preserve order
    });

    // Allow Lambda to read from the SQS FIFO queue
    snsToLambdaQueue.grantConsumeMessages(snsToEventBridgeLambda);

    // EventBridge Rule → forward to destination SQS
    const rule = new events.Rule(this, 'EBRuleForwardToSQS', {
      ruleName: 'JsonTransformAndForward',
      eventBus: eventBus,
      eventPattern: {
        source: ['custom.sns.source'],
        detail: { eventType: ['evMetadatgaCApture'] },
      },
      targets: [
        new targets.SqsQueue(destinationQueue, {
          message: events.RuleTargetInput.fromObject({
            sourceSystem: 'request-decisioning-service',
            workflowStageType: 'CONCERN_INITIATED',
            decisionOutComeRequestContext: {
              decisionOutComeRequestId: events.EventField.fromPath('$.detail.decisionOutComeRequestId'),
              decisionOutComeRequestItems: [],
            },
            decisionOutComeContextItems: [
              {
                decisionOutComeId: events.EventField.fromPath('$.detail.eventDataList[0].decisionOutComeId'),
                decisionOutComeItems: [],
              },
            ],
          }),
          messageGroupId: events.EventField.fromPath('$.detail.fifoMetadata.messageGroupId'),
          // messageDeduplicationId: events.EventField.fromPath('$.detail.fifoMetadata.dedupId'),
        }),
      ],
    });

    // 🔑 Add permission for EventBridge to send messages to destination SQS
    destinationQueue.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('events.amazonaws.com')],
      actions: ['sqs:SendMessage'],
      resources: [destinationQueue.queueArn],
      conditions: {
        ArnEquals: {
          'aws:SourceArn': `arn:aws:events:${this.region}:${this.account}:rule/${eventBus.eventBusName}/${rule.ruleName}`,
        },
      },
    }));
  }
}

