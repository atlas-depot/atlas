import { defineSchedule } from "eve/schedules";
import { reconcileConversationAnswers, reconcileOrganizerRuns } from "../../maintenance.ts";
import { reconcileNoteIndexes } from "../../index-runtime.ts";

export default defineSchedule({
  cron: "* * * * *",
  run: async () => {
    const results = await Promise.allSettled([
      reconcileOrganizerRuns(),
      reconcileNoteIndexes(),
      reconcileConversationAnswers(),
    ]);
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Maintenance has pending work.");
  },
});
