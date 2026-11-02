import { defineSchedule } from "eve/schedules";
import { reconcileOrganizerRuns } from "../../maintenance.ts";

export default defineSchedule({
  cron: "* * * * *",
  run: async () => {
    await reconcileOrganizerRuns();
  },
});
