import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { logger } from "../../shared/logger";
import { connectSuccess, connectError } from "../../shared/connect-response";

const ddb = new DynamoDBClient({});
const TABLE_NAME = process.env.POLICIES_TABLE_NAME!;

interface ConnectEvent {
  Details: {
    ContactData: {
      ContactId: string;
      CustomerEndpoint: { Address: string };
      Attributes: Record<string, string>;
    };
    Parameters: Record<string, string>;
  };
}

export async function handler(event: ConnectEvent) {
  const contactId = event.Details.ContactData.ContactId;
  const phoneNumber = event.Details.ContactData.CustomerEndpoint.Address;

  logger.setContext({ contactId, service: "connect" });
  logger.info("Customer lookup initiated", { phoneNumber });

  try {
    const result = await ddb.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: { S: `PHONE#${phoneNumber}` },
          SK: { S: "PROFILE" },
        },
      })
    );

    if (!result.Item) {
      logger.info("Customer not found", { phoneNumber });
      return connectSuccess({
        customerFound: "false",
      });
    }

    const customer = unmarshall(result.Item);
    logger.info("Customer found", {
      customerId: customer.customerId,
    });

    return connectSuccess({
      customerFound: "true",
      customerId: customer.customerId,
      customerName: customer.name,
      policyNumber: customer.policyNumber,
      policyStatus: customer.policyStatus,
    });
  } catch (err) {
    logger.error("Customer lookup failed", err as Error);
    return connectError("LOOKUP_FAILED");
  }
}
