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

    // SNS FIFO Topic
    const topic = new sns.Topic(this, 'SourceSNSTopic', {
      displayName: 'Source SNS FIFO Topic',
      topicName: 'source-sns-topic.fifo',
      fifo: true,
      contentBasedDeduplication: true,
    });

    // SQS FIFO Queue (between SNS FIFO and Lambda)
    const snsToLambdaQueue = new sqs.Queue(this, 'SnsToLambdaQueue', {
      queueName: 'sns-to-lambda-queue.fifo',
      fifo: true,
      contentBasedDeduplication: true,
    });

    // Subscribe the FIFO queue to SNS FIFO
    topic.addSubscription(new snsSubscriptions.SqsSubscription(snsToLambdaQueue));

    // Destination Queue (standard SQS)
    const destinationQueue = new sqs.Queue(this, 'DestinationQueue', {
  queueName: 'destination-queue.fifo',
  fifo: true,
  contentBasedDeduplication: true,
});


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
  new events.Rule(this, 'EBRuleForwardToSQS', {
  ruleName: 'JsonTransformAndForward',
  eventBus: eventBus,
  eventPattern: {
    source: ['custom.sns.source'],
    //detail: { eventType: ['evMetadatgaCApture'] },
    detail: { payload: { eventType: ['evMetadatgaCApture'] } },
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
      ///messageDeduplicationId: events.EventField.fromPath('$.detail.fifoMetadata.dedupId'),
    }),
  ],
});

  }
}

