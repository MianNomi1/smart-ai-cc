export interface ConnectLambdaResponse {
  [key: string]: string;
}

export function connectSuccess(
  attributes: Record<string, string>
): ConnectLambdaResponse {
  return {
    resultStatus: "SUCCESS",
    ...attributes,
  };
}

export function connectError(errorType: string): ConnectLambdaResponse {
  return {
    resultStatus: "ERROR",
    errorType,
  };
}
