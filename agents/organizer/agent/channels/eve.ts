import { httpBasic } from "eve/channels/auth";
import { defaultEveAuth, eveChannel } from "eve/channels/eve";
import { readConfig } from "../../config.ts";
import { CHAT_PRINCIPAL, API_PRINCIPAL, CONTEXT_PRINCIPAL } from "../../job.ts";

const password = readConfig().ORGANIZER_SERVICE_TOKEN;

export default eveChannel({
  // The username selects the job. Both are held only by the Atlas API.
  auth: [
    httpBasic({ username: API_PRINCIPAL, password }),
    httpBasic({ username: CHAT_PRINCIPAL, password }),
    httpBasic({ username: CONTEXT_PRINCIPAL, password }),
  ],
  onMessage: (ctx) => ({
    auth: defaultEveAuth(ctx),
    title:
      ctx.eve.caller?.principalId === CHAT_PRINCIPAL
        ? "Atlas Answer"
        : ctx.eve.caller?.principalId === CONTEXT_PRINCIPAL
          ? "Atlas Context"
          : "Atlas Organize",
  }),
});
