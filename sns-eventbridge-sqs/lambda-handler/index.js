import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const client = new EventBridgeClient({});

export const handler = async (event) => {
  console.log("Received SNS event:", JSON.stringify(event));

  const message = event.Records?.[0]?.Sns?.Message ?? '{}';
  
  const params = {
    Entries: [
      {
        Source: 'custom.sns.source',
        DetailType: 'SNSMessage',
        Detail: message,
        EventBusName: process.env.EVENT_BUS_NAME,
      },
    ],
  };

  try {
    const result = await client.send(new PutEventsCommand(params));
    console.log("Event sent to EventBridge:", result);
  } catch (err) {
    console.error("Failed to send event:", err);
    throw err;
  }
};
