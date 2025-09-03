import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SnsEventbridgeSqsStack } from '../lib/sns-eventbridge-sqs-stack';

describe('SnsEventbridgeSqsStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new SnsEventbridgeSqsStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  test('SNS topic is created', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      DisplayName: 'Source SNS Topic',
    });
  });

  test('SQS queue is created', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'destination-queue',
    });
  });

  test('Custom EventBus is created', () => {
    template.hasResourceProperties('AWS::Events::EventBus', {
      Name: 'CustomJsonTransformBus',
    });
  });
  /*

  test('Lambda has EventBus name in environment variables', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          //EVENT_BUS_NAME: 'CustomJsonTransformBus',
          EVENT_BUS_NAME: { Ref: Match.stringLikeRegexp('CustomJsonTransformBus.*') },
        },
      },
      Runtime: 'nodejs22.x',
    });
  });
 */

/*

  test('Lambda has EventBus name in environment variables', () => {
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: {
      Variables: {
        //EVENT_BUS_NAME: Match.anyValue(),
        EVENT_BUS_NAME: { Ref: Match.stringLikeRegexp('CustomJsonTransformBus.*') },
      },
    },
  });
});
*/

test('Lambda has EventBus name in environment variables', () => {
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: {
      Variables: {
        EVENT_BUS_NAME: Match.objectLike({
          Ref: Match.stringLikeRegexp('CustomEventBus.*'),
        }),
      },
    },
  });
});

test('EventBridge Rule forwards to SQS with correct JSON transformation', () => {
  template.hasResourceProperties('AWS::Events::Rule', {
    Name: 'JsonTransformAndForward',
    EventPattern: {
      source: ['custom.sns.source'],
      detail: {
      eventType: ['evMetadatgaCApture'],
    },
    },
    Targets: Match.arrayWith([
      Match.objectLike({
        InputTransformer: {
          InputPathsMap: {
            'detail-decisionOutComeRequestId': '$.detail.decisionOutComeRequestId',
            'detail-eventDataList-0--decisionOutComeId': '$.detail.eventDataList[0].decisionOutComeId',
          },
          InputTemplate: Match.stringLikeRegexp(
            '.*<detail-decisionOutComeRequestId>.*<detail-eventDataList-0--decisionOutComeId>.*'
          ),
        },
      }),
    ]),
  });
});

});
