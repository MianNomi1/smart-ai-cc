import { logger } from "../../shared/logger";
import { lexDelegate, lexClose } from "../../shared/lex-response";

interface LexEvent {
  sessionId: string;
  inputTranscript: string;
  interpretations: Array<{
    intent: {
      name: string;
      slots: Record<string, { value: { interpretedValue: string } } | null>;
      state: string;
    };
    nluConfidence: { score: number };
  }>;
  sessionState: {
    intent: {
      name: string;
      slots: Record<string, { value: { interpretedValue: string } } | null>;
      state: string;
    };
    sessionAttributes: Record<string, string>;
  };
  invocationSource: "DialogCodeHook" | "FulfillmentCodeHook";
}

export async function handler(event: LexEvent) {
  const intent = event.sessionState.intent;
  const slots = intent.slots;
  const source = event.invocationSource;

  logger.setContext({
    service: "lex",
    contactId: event.sessionState.sessionAttributes?.contactId,
  });

  logger.info("Validate claim invoked", {
    intentName: intent.name,
    invocationSource: source,
    slots: JSON.stringify(slots),
  });

  if (source === "DialogCodeHook") {
    return lexDelegate(intent.name, slots, event.sessionState.sessionAttributes);
  }

  if (source === "FulfillmentCodeHook") {
    const policyNumber = slots.PolicyNumber?.value?.interpretedValue;
    const claimType = slots.ClaimType?.value?.interpretedValue;
    const incidentDate = slots.IncidentDate?.value?.interpretedValue;

    if (!policyNumber || !claimType || !incidentDate) {
      return lexClose(
        intent.name,
        "Failed",
        "I'm missing some information to file your claim. Please try again.",
        event.sessionState.sessionAttributes
      );
    }

    logger.info("Filing claim", { policyNumber, claimType, incidentDate });

    return lexClose(
      intent.name,
      "Fulfilled",
      `I've started a claim for policy ${policyNumber}. Your claim reference is CLM-${Date.now()}. A claims specialist will contact you within 24 hours.`,
      event.sessionState.sessionAttributes
    );
  }

  return lexDelegate(intent.name, slots, event.sessionState.sessionAttributes);
}
