import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const client = new EventBridgeClient({});

export const handler = async (event) => {
  console.log("Received SQS FIFO event:", JSON.stringify(event));

  for (const record of event.Records) {
    const messageBody = record.body;
    console.log("Raw SQS body:", messageBody);

    let message;
    try {
      message = JSON.parse(messageBody);
    } catch (e) {
      message = messageBody;
    }

    const messageGroupId = record.attributes?.MessageGroupId;
    const dedupId = record.attributes?.MessageDeduplicationId;

    // Carry FIFO metadata inside EventBridge detail
    const detail = {
      payload: message,
      fifoMetadata: {
        messageGroupId,
        dedupId,
      },
    };

    const params = {
      Entries: [
        {
          Source: "custom.sns.source",
          DetailType: "SNSMessage",
          Detail: JSON.stringify(detail),
          EventBusName: process.env.EVENT_BUS_NAME,
        },
      ],
    };

    try {
      const result = await client.send(new PutEventsCommand(params));
      console.log(
        `Event sent to EventBridge (GroupId=${messageGroupId}, DedupId=${dedupId}):`,
        result
      );
    } catch (err) {
      console.error("Failed to send event:", err);
      throw err;
    }
  }
};
