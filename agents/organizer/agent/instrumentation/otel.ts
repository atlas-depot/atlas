import { otel } from "eve/instrumentation/otel";

export default otel({
  tracePolicy: () => ({ emit: false, recordInputs: false, recordOutputs: false }),
});
