import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export class SnsEventbridgeSqsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 🔑 KMS Key with rotation (used for both SNS + SQS)
    const kmsKey = new kms.Key(this, 'MessagingKey', {
      enableKeyRotation: true,
      alias: 'alias/sns-sqs-key',
    });

    // SNS FIFO Topic with KMS encryption
    const topic = new sns.Topic(this, 'SourceSNSTopic', {
      displayName: 'Source SNS FIFO Topic',
      topicName: 'source-sns-topic.fifo',
      fifo: true,
      contentBasedDeduplication: false,
      masterKey: kmsKey, // ✅ Encryption at rest
    });

    // Deny non-TLS access to SNS
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['SNS:Publish', 'SNS:Subscribe'],
        resources: [topic.topicArn],
        conditions: {
          Bool: { 'aws:SecureTransport': 'false' }, // ✅ SC-8 / SC-28
        },
      }),
    );

    // SQS FIFO Queue (between SNS FIFO and Lambda) with encryption + enforce SSL
    const snsToLambdaQueue = new sqs.Queue(this, 'SnsToLambdaQueue', {
      queueName: 'sns-to-lambda-queue.fifo',
      fifo: true,
      contentBasedDeduplication: false,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: kmsKey,
      enforceSSL: true, // ✅ Only TLS
    });

    // Subscribe the FIFO queue to SNS FIFO
    topic.addSubscription(new snsSubscriptions.SqsSubscription(snsToLambdaQueue));

    // Destination FIFO Queue with encryption
    const destinationQueue = new sqs.Queue(this, 'DestinationQueue', {
      queueName: 'destination-queue.fifo',
      fifo: true,
      contentBasedDeduplication: true,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: kmsKey,
      enforceSSL: true,
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

    // Grant permissions
    eventBus.grantPutEventsTo(snsToEventBridgeLambda);
    snsToLambdaQueue.grantConsumeMessages(snsToEventBridgeLambda);
    topic.grantPublish(snsToEventBridgeLambda);

    // Connect Lambda to poll from the FIFO queue
    snsToEventBridgeLambda.addEventSourceMapping('SnsToLambdaQueueMapping', {
      eventSourceArn: snsToLambdaQueue.queueArn,
      batchSize: 1, // FIFO → preserve order
    });

    // EventBridge Rule → forward to destination SQS
    new events.Rule(this, 'EBRuleForwardToSQS', {
      ruleName: 'JsonTransformAndForward',
      eventBus: eventBus,
      eventPattern: {
        source: ['custom.sns.source'],
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
        }),
      ],
    });

    // 🔎 Outputs
    new cdk.CfnOutput(this, 'SNSTopicName', { value: topic.topicName });
    new cdk.CfnOutput(this, 'SNSQueueName', { value: snsToLambdaQueue.queueName });
    new cdk.CfnOutput(this, 'DestinationQueueName', { value: destinationQueue.queueName });
  }
}

