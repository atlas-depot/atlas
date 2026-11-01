import { httpBasic } from "eve/channels/auth";
import { defaultEveAuth, eveChannel } from "eve/channels/eve";
import { readConfig } from "../../config.ts";

export default eveChannel({
  auth: httpBasic({ username: "atlas-api", password: readConfig().ORGANIZER_SERVICE_TOKEN }),
  onMessage: (ctx) => ({ auth: defaultEveAuth(ctx), title: "Atlas Organize" }),
});
