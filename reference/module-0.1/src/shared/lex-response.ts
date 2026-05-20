export interface LexDialogAction {
  type: "Close" | "ConfirmIntent" | "Delegate" | "ElicitIntent" | "ElicitSlot";
}

export interface LexMessage {
  contentType: "PlainText" | "SSML" | "CustomPayload";
  content: string;
}

export interface LexResponse {
  sessionState: {
    dialogAction: LexDialogAction;
    intent?: {
      name: string;
      state?: "Fulfilled" | "Failed" | "InProgress" | "ReadyForFulfillment";
      slots?: Record<string, unknown>;
    };
    sessionAttributes?: Record<string, string>;
  };
  messages?: LexMessage[];
}

export function lexClose(
  intentName: string,
  state: "Fulfilled" | "Failed",
  message: string,
  sessionAttributes?: Record<string, string>
): LexResponse {
  return {
    sessionState: {
      dialogAction: { type: "Close" },
      intent: { name: intentName, state },
      sessionAttributes,
    },
    messages: [{ contentType: "PlainText", content: message }],
  };
}

export function lexDelegate(
  intentName: string,
  slots: Record<string, unknown>,
  sessionAttributes?: Record<string, string>
): LexResponse {
  return {
    sessionState: {
      dialogAction: { type: "Delegate" },
      intent: { name: intentName, slots },
      sessionAttributes,
    },
  };
}

export function lexElicitSlot(
  intentName: string,
  slotToElicit: string,
  slots: Record<string, unknown>,
  message: string,
  sessionAttributes?: Record<string, string>
): LexResponse {
  return {
    sessionState: {
      dialogAction: {
        type: "ElicitSlot",
        slotToElicit,
      } as LexDialogAction & { slotToElicit: string },
      intent: { name: intentName, slots },
      sessionAttributes,
    },
    messages: [{ contentType: "PlainText", content: message }],
  };
}
