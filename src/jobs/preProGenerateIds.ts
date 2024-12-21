import api, { Flatfile } from "@flatfile/api";
import { Action } from "@flatfile/api/api";
import FlatfileListener from "@flatfile/listener";
import {
  JobError,
  ColumnJobWorker,
  TriggeredBy,
} from "../support/utils/job.worker";
import { safe } from "../support/requests";
import { Simplified } from "@flatfile/util-common";

export const ACTION_GENERATE_IDS = "generate-ids";

export const generateIdsPlugin = () => {
  return (listener: FlatfileListener) => {
    listener.on("file:updated", async (event) => {
      const environmentId = event.context.environmentId;
      const spaceId = event.context.spaceId;
      const fileId = event.context.fileId;
      const file = await event.cache.init("file", async () =>
        safe.files.get(fileId)
      );

      if (file.workbookId) {
        const actionsBody = [
          {
            label: "Generate IDs",
            operation: ACTION_GENERATE_IDS,
            description: "Generate unique IDs based on this field",
            type: ACTION_GENERATE_IDS,
            primary: true,
            confirm: true,
            mode: "foreground",
            targetId: file.workbookId,
            id: "no-please-dont-be-used",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            mount: {
              type: "field",
              onSelect: {
                type: "field",
                options: {
                  allowMultiple: false,
                },
              },
            },
          },
        ];
        const response = await fetch(
          `${
            process.env.FLATFILE_API_URL || process.env.AGENT_INTERNAL_URL
          }/v1/actions/bulk?spaceId=${spaceId}&environmentId=${environmentId}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.FLATFILE_BEARER_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(actionsBody),
          }
        );
        console.log("Add column action response", await response.json());
      }
    });
  };
};

@TriggeredBy(ACTION_GENERATE_IDS)
export class GenerateIdsJob extends ColumnJobWorker {
  async execute(): Promise<void | Flatfile.JobOutcome> {
    const { sheetId, jobId } = this.event.context;
    const { records } = await this.event.data();
    let processedCount = 0;
    const updates = [];

    const fieldKey = this.columnKey;

    if (!fieldKey) {
      throw new JobError("No field selected for ID generation");
    }

    if (records.length === 0) {
      throw new JobError("No records found to generate IDs");
    }

    // Create a new field for IDs if it doesn't exist
    await api.sheets.addField(sheetId, {
      insertAtIndex: 0,
      body: {
        key: "generated_id",
        type: "string",
        label: "Generated ID",
        description: "Auto-generated unique identifier",
      },
    });

    await delay(2000);

    const numpadMap: { [key: string]: string } = {
      a: "2",
      b: "2",
      c: "2",
      d: "3",
      e: "3",
      f: "3",
      g: "4",
      h: "4",
      i: "4",
      j: "5",
      k: "5",
      l: "5",
      m: "6",
      n: "6",
      o: "6",
      p: "7",
      q: "7",
      r: "7",
      s: "7",
      t: "8",
      u: "8",
      v: "8",
      w: "9",
      x: "9",
      y: "9",
      z: "9",
    };

    await this.progress.report("Analyzing...", 50);

    // Keep track of displayNames and their corresponding generated IDs
    const displayNameToId = new Map<string, string>();
    // Keep track of the highest sequence per baseId
    const baseIdMaxSeq = new Map<string, bigint>();

    // First pass: Generate IDs for unique displayNames
    records.forEach((record) => {
      const displayName = record.values[fieldKey]?.value?.toString() || "";

      // If we haven't seen this displayName before, generate a new ID
      if (!displayNameToId.has(displayName)) {
        // Get first 5 chars of the field value and convert to numpad numbers
        const baseId = displayName
          .toLowerCase()
          .slice(0, 5)
          .split("")
          .map((c) => numpadMap[c] || "0")
          .join("");

        // Get the next sequence number for this baseId
        let nextSeq = (baseIdMaxSeq.get(baseId) || BigInt(0)) + BigInt(1);
        baseIdMaxSeq.set(baseId, nextSeq);

        // Create the new ID
        const seqStr = nextSeq.toString();
        const generatedId =
          baseId + (seqStr.length <= 3 ? seqStr.padStart(3, "0") : seqStr);

        // Store the generated ID for this displayName
        displayNameToId.set(displayName, generatedId);
      }

      // Update the record with the generated ID (whether it's new or existing)
      const generatedId = displayNameToId.get(displayName);
      if (generatedId) {
        updates.push({
          _id: record.id,
          generated_id: generatedId,
        });
        processedCount++;
      }
    });

    // Remove the second pass since we're handling updates in the first pass

    // Update all records with new IDs
    const chunkSize = 1000;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      await Simplified.updateAllRecords(sheetId, chunk as any);
    }

    await api.jobs.complete(jobId, {
      info: `Completed processing ${processedCount} records`,
    });
    return {
      acknowledge: true,
      heading: "IDs Generated",
      message: `Successfully generated IDs for ${records.length} records`,
    };
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
