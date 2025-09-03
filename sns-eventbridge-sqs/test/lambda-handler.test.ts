import { handler } from '../lambda-handler/index';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

jest.mock('@aws-sdk/client-eventbridge');

describe('SNS → EventBridge Lambda handler', () => {
  let sendMock: jest.Mock;

  beforeEach(() => {
    sendMock = jest.fn().mockResolvedValue({ FailedEntryCount: 0 });
    (EventBridgeClient as jest.Mock).mockImplementation(() => ({ send: sendMock }));
  });

  afterEach(() => jest.resetAllMocks());

  test('sends SNS message to EventBridge', async () => {
    const snsEvent = {
      Records: [
        {
          Sns: {
            Message: JSON.stringify({
              eventType: 'evMetadatgaCApture',
              decisionOutComeRequestId: '1',
              eventDataList: [{ decisionOutComeId: '1', metadata: [{ skme: 'skvalue' }] }],
            }),
          },
        },
      ],
    };

    await handler(snsEvent);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const callArgs = sendMock.mock.calls[0][0];
    expect(callArgs).toBeInstanceOf(PutEventsCommand);
    expect(callArgs.input.Entries[0]).toMatchObject({
      Source: 'custom.sns.source',
      DetailType: 'SNSMessage',
      Detail: snsEvent.Records[0].Sns.Message,
      EventBusName: process.env.EVENT_BUS_NAME,
    });
  });

  test('throws when EventBridge client fails', async () => {
    sendMock.mockRejectedValue(new Error('Failed to send'));
    const snsEvent = { Records: [{ Sns: { Message: '{}' } }] };
    await expect(handler(snsEvent)).rejects.toThrow('Failed to send');
  });
});

