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

    /**
     * Import existing SNS FIFO topic
     */
    const topic = sns.Topic.fromTopicArn(
      this,
      'ImportedSNSTopic',
      'arn:aws:sns:us-east-1:747929218943:source-sns-topic.fifo'
    );

    /**
     * Import existing Destination FIFO Queue
     */
    const destinationQueue = sqs.Queue.fromQueueArn(
      this,
      'ImportedDestinationQueue',
      'arn:aws:sqs:us-east-1:747929218943:destination-queue.fifo'
    );

    /**
     * Create SQS FIFO queue between SNS and Lambda
     * (this one is new)
     */
    const snsToLambdaQueue = new sqs.Queue(this, 'SnsToLambdaQueue', {
      queueName: 'sns-to-lambda-queue.fifo',
      fifo: true,
      contentBasedDeduplication: false, // keep it false to allow explicit dedupId
    });

    // Subscribe intermediate queue to SNS FIFO
    topic.addSubscription(new snsSubscriptions.SqsSubscription(snsToLambdaQueue));

    /**
     * Create custom EventBridge bus
     */
    const eventBus = new events.EventBus(this, 'CustomEventBus', {
      eventBusName: 'CustomJsonTransformBus',
    });

    /**
     * Lambda to poll SQS FIFO and forward messages to EventBridge
     */
    const snsToEventBridgeLambda = new lambda.Function(this, 'SnsToEventBridgeLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda-handler')),
      environment: {
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });

    eventBus.grantPutEventsTo(snsToEventBridgeLambda);

    snsToEventBridgeLambda.addEventSourceMapping('SnsToLambdaQueueMapping', {
      eventSourceArn: snsToLambdaQueue.queueArn,
      batchSize: 1, // FIFO → preserve order
    });

    snsToLambdaQueue.grantConsumeMessages(snsToEventBridgeLambda);

    /**
     * EventBridge Rule → forward to existing destination FIFO queue
     */
    new events.Rule(this, 'EBRuleForwardToSQS', {
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
              decisionOutComeRequestId: events.EventField.fromPath('$.detail.payload.decisionOutComeRequestId'),
              decisionOutComeRequestItems: [],
            },
            decisionOutComeContextItems: [
              {
                decisionOutComeId: events.EventField.fromPath('$.detail.payload.eventDataList[0].decisionOutComeId'),
                decisionOutComeItems: [],
              },
            ],
          }),
          messageGroupId: events.EventField.fromPath('$.detail.fifoMetadata.messageGroupId'),
          // messageDeduplicationId: events.EventField.fromPath('$.detail.fifoMetadata.dedupId'),
        }),
      ],
    });
  }
}

