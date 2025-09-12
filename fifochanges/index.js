import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const client = new EventBridgeClient({});

export const handler = async (event) => {
  console.log("Received SQS FIFO event:", JSON.stringify(event));

  for (const record of event.Records) {
    console.log("Raw SQS record body:", record.body);

    let snsEnvelope;
    try {
      snsEnvelope = JSON.parse(record.body);
    } catch (e) {
      console.error("Failed to parse SQS body as JSON:", e);
      continue;
    }

    // The actual SNS message is nested in the envelope
    let message;
    try {
      message = JSON.parse(snsEnvelope.Message);
    } catch (e) {
      console.warn("SNS.Message not JSON, treating as string");
      message = snsEnvelope.Message;
    }

    // Extract FIFO attributes from the SQS record
    const messageGroupId = record.attributes?.MessageGroupId;
    const dedupId = record.attributes?.MessageDeduplicationId;

    // Build the EventBridge detail object
    const detail = {
      payload: message,
      fifoMetadata: {
        messageGroupId,
        dedupId,
      },
    };

    console.log("Detail to forward to EventBridge:", JSON.stringify(detail));

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
      console.log("Sending to EventBridge:", JSON.stringify(params));
      const result = await client.send(new PutEventsCommand(params));
      console.log(
        `Event sent to EventBridge (GroupId=${messageGroupId}, DedupId=${dedupId}):`,
        JSON.stringify(result)
      );
    } catch (err) {
      console.error("Failed to send event:", err);
      throw err;
    }
  }
};

