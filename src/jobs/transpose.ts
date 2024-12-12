import api from "@flatfile/api";
import { JobOutcome } from "@flatfile/api/api";
import FlatfileListener from "@flatfile/listener";
import { Collection } from "collect.js";
import { sendPrompt } from "../support/send.prompt";
import { safe } from "../support/requests";
import { Item } from "../support/requests/records/item";
import { ColumnJobWorker, TriggeredBy } from "../support/utils/job.worker";

export function transposeHook(listener: FlatfileListener) {
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
          operation: "transpose",
          label: "Transpose Group",
          primary: true,
          mode: "foreground",
          targetId: file.workbookId,
          id: "no-please-dont-be-used",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          mount: { type: "field" },
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

  listener
    .namespace("workbook:transpose-preview")
    .on("commit:created", async (e) => {
      console.log("handler");

      const claudeApiKey = await e.secrets("CLAUDE_API_KEY");

      const job = await safe.jobs.create({
        source: e.context.sheetId,
        operation: "show-spinner",
        type: "sheet",
        mode: "foreground",
        managed: false,
        status: "executing",
        info: "Re-analyzing sheet. This can take up to 30 seconds...",
      });

      const records = await safe.records.stream({ sheetId: e.context.sheetId });

      await processRecords(claudeApiKey, records);

      if (records.changes().isNotEmpty()) {
        await safe.records.write(
          { sheetId: e.context.sheetId, silent: true },
          records
        );
      }

      await api.jobs.complete(job.id);
    });
}

@TriggeredBy("transpose")
export class TransposeColumns extends ColumnJobWorker {
  async execute(): Promise<JobOutcome> {
    const workbook = await safe.workbooks.create({
      name: `transpose ${new Date()}`, // hack so it doesn't show
      labels: ["file"],
      namespace: "transpose-preview",
      spaceId: this.spaceId,
      metadata: {
        originalSheet: this.sheetId,
      },
      sheets: [
        {
          name: "Columns to Transpose",
          slug: "cols-to-transpose",
          fields: [
            {
              key: "Select",
              label: "Hint",
              type: "boolean",
              appearance: { size: "xs" },
            },
            {
              key: "Column",
              label: "Column",
              type: "string",
              readonly: true,
              appearance: { size: "l" },
            },
            {
              key: "Group Row",
              label: "Group Row",
              readonly: true,
              type: "string",
              appearance: { size: "xs" },
            },
            {
              key: "Group Modifier",
              label: "Group Modifier",
              readonly: true,
              type: "string",
              appearance: { size: "xs" },
            },
            { key: "Key", label: "Key", readonly: true, type: "string" },
          ],
        },
      ],
    });

    const { data: document } = await api.documents.create(this.spaceId, {
      title: "Choose columns to transpose",
      body: `
# Review Transpose Plan

Check the **Hint** box next one or two columns you want transpose. Based on your selection, we will attempt to discover groups of columns related to your selected column
to repeat in the transposed group.

**⚠️YOU CAN ONLY TRANSPOSE ONE GROUP AT A TIME**

You will see the detected groups appear in the Group Row and Key columns once the analysis is complete. You do not need to toggle a hint for every column but if you see columns
appear that you do not want in the group, toggle them off, or inversely add more until you are satisfied with the grouping plan.

<embed type='embedded-sheet' name='Review Transpose Plan Below' defaultExpanded='true' sheetId='${workbook.sheets[0].id}' workbookId='${workbook.id}'>
      `,
      treatments: ["ephemeral"],

      actions: [
        {
          label: "Continue",
          operation: "transpose-execute",
          primary: true,
        },
      ],
    });

    const sheet = await this.sheet();

    const columns = sheet.config.fields.map((col) => ({
      Select: col.key === this.columnKey ? true : null,
      Column: col.key,
    }));

    await safe.records.writeRaw(
      {
        sheetId: workbook.sheets[0].id,
      },
      columns
    );

    const records = await safe.records.stream({
      sheetId: workbook.sheets[0].id,
    });

    await this.progress.report("Analying...", 50);

    const claudeApiKey = await this.event.secrets("CLAUDE_API_KEY");
    await processRecords(claudeApiKey, records);

    await safe.records.write({ sheetId: workbook.sheets[0].id }, records);

    return {
      acknowledge: false,
      // @ts-ignore
      trigger: { type: "automatic_silent", audience: "all" },
      next: {
        type: "id",
        id: document.id,
      },
    };
  }
}

/**
 * Queries anthrophic to get a list of column groups for a sheet which represent individual banking data items.
 * @param sheet Sheet to extract columns from.
 * @param columnKey The key of the column to group by.
 * @returns list of string-lists with each sub-list containing column names that belong into a single banking data item.
 * @throws Error if the response cannot be parsed into an object.
 */
async function getColumnGrouping(
  apiKey: string,
  sheet: Collection<Item>,
  keys: string[],
  excludes: string[]
): Promise<any[]> {
  const prompt = getPromptForColumnGrouping(sheet, keys, excludes);
  console.log("calling AI with ", prompt);
  const response = await sendPrompt("", prompt, apiKey); // ignore setup ("")

  // @ts-ignore
  console.log(response.content[0].text);

  if (response?.content?.length > 0) {
    try {
      // @ts-ignore
      const obj = JSON.parse(response.content[0].text);
      if (obj.dataItems) {
        return obj.dataItems as string[][];
      } else {
        throw new Error(
          // @ts-ignore
          `No items found within JSON response ${response.content[0].text}`
        );
      }
    } catch (e) {
      throw new Error(
        // @ts-ignore
        `Failed to parse JSON response ${response.content[0].text}`
      );
    }
  } else {
  }
}

/**
 * Prompt to return column grouping given the selected column key and the sheet (and its fields).
 * The desired structure for the output is a json object with a field dataItems of type string[][], which contains lists of column lists.
 *
 * @param sheet
 * @returns A string with the prompt to provide for AI to the desired column grouping.
 */
function getPromptForColumnGrouping(
  fields: Collection<Item>,
  keys: string[],
  excludes: string[]
): string {
  const promptFields = fields.map((f) => f.str("Column")).join(",");
  return `
      You are a code generator specializing in data analysis. All your output must be valid JSON code in the format, representing a single discovered group of related columns.
  
      Given the following column names, identify groups of related columns that share a common repeating pattern and have a numerical modifier.
  
      Groups can appear with numeric indices (1, 2, 3), as ordinals (first, second, third), or as adjectives (primary, secondary, tertiary).

      Always return the "index" as a new column name with the same name as the group with __ in front of it using the word "modifier" such as __address_modifier
      
      Example #1:
        Instructions: Find nested groups of columns with a numeric separator.
        Input: name, email, address_1_street, address_1_city, address_1_state, address_1_zip, address_2_street, address_2_city, address_2_state, address_2_zip
        Output: [{ "--MODIFIER": "1", "address_street": "address_1_street", "address_city": "address_1_city", "address_state": "address_1_state", "address_zip": "address_1_zip" }, { "--MODIFIER": "2", "address_street": "address_2_street", "address_city": "address_2_city", "address_state": "address_2_state", "address_zip": "address_2_zip" }]
      
      Example #2:
        Instructions: Handle single-value repeated groups by using the group name as the column name.
        Input: name, email, phone (1), phone (2), phone (3)
        Output: [{ "--MODIFIER": "1", "phone": "phone (1)"}, { "--MODIFIER": "2", "phone": "phone (2)" },  { "--MODIFIER": "3", "phone": "phone (3)" }]
  
      Example #3:
        Input: name, email, Primary Phone, Secondary Phone, Tertiary Phone
        Output: [{ "--MODIFIER": "Primary", "phone": "Primary Phone" }, { "--MODIFIER": "Secondary", "phone": "Secondary Phone" }, { "--MODIFIER": "Tertiary", "phone": "Tertiary Phone" }]
  
      Example #4:
        Input: name, email, first_emergency_contact_name, first_emergency_contact_phone, second_emergency_contact_name, second_emergency_contact_phone
        Output: [{"--MODIFIER": "first", "emergency_contact_name": "first_emergency_contact_name", "emergency_contact_phone": "first_emergency_contact_phone" }, { "--MODIFIER": "second", "emergency_contact_name": "second_emergency_contact_name", "emergency_contact_phone": "second_emergency_contact_phone" }]
      
      Example #5:
        Input: Billing Address, Billing Address Line 1, Billing Address Line 2, Billing Zip, Billing City, Billing State, Shipping Address, Shipping Address Line 1, Shipping Address Line 2, Shipping Zip, Shipping City, Shipping State
        Output: [{ "--MODIFIER": "Billing", "Address": "Billing Address", "Address Line 1": "Billing Address Line 1", "Address Line 2": "Billing Address Line 2", "Zip": "Billing Zip", "City": "Billing City", "State": "Billing State" }, { "--MODIFIER": "Shipping", "Address": "Shipping Address", "Address Line 1": "Shipping Address Line 1", "Address Line 2": "Shipping Address Line 2", "Zip": "Shipping Zip", "City": "Shipping City", "State": "Shipping State" }]
  
      # Rules to follow
      
      ## Rule 1: DO NOT identify patterns with partial groups.
      If one entry in a group has a missing column, do not identify the group at all
      For example if you have columns: name, email, address_1_street, address_1_city, address_1_state, address_1_zip, address_2_street, address_2_zip
      Do not create a group for "address" as one of its entries is missing city and state
      
      ## Rule 2: Exclude patterns that are part of other non repeating structures
      Exclude patterns that are part of common repeated structures like addresses. For example in this pattern: primary_address_street, primary_address_line_1, primary_address_line_2, primary_address_zip YOU SHOULD NOT RECOGNIZE the repeating pattern for line_1 and line_2 because it's part of the primary address group and the other columns in that group are not repeating
      
      ## Rule 4: ONLY recognize one group at a time
      
      ## Rule 6: Ignore wildcards in field names. They mean nothing
      Do not recognize patterns like "full_name*", "email*". This is not a repeating pattern.
      
      ----
      
      Here are your column names, find the repeating patterns and group them together:
      ${promptFields}
  
      Make sure that the column(s) ${keys.join(
        ", "
      )} are included in the groups, and only return the groups related to those keys. DO NOT include any of the following fields in the group ${excludes.join(
    ", "
  )}
      
      Do not add any explainer after the JSON response. Wrap the response in an object where the key is "dataItems" and the value is the array of groups.
      `;
}

async function processRecords(apiKey: string, records: Collection<Item>) {
  const selected = records.filter((r) => r.get("Select"));
  const excluded = records.filter((r) => r.get("Select") === false);

  // exclude selections made via AI using metadata
  if (selected.isEmpty()) {
    console.log("no selected");
    return;
  }

  // trigger a foreground sheet job for recalculating groups
  const grouping = await getColumnGrouping(
    apiKey,
    records,
    selected.map((s) => s.str("Column")).all(),
    excluded.map((s) => s.str("Column")).all()
  );

  console.log(grouping);
  records.each((r) => {
    r.set("Group Row", null);
    r.set("Group Modifier", null);
    r.set("Key", null);
  });

  if (grouping?.length) {
    grouping.forEach((group, i) => {
      Object.entries(group).forEach(([newKey, originalKey]) => {
        const current = records.first((r) => r.str("Column") === originalKey);
        if (current) {
          current.set("Group Row", i + 1);
          current.set("Key", newKey);
          current.set("Group Modifier", group["--MODIFIER"]);
        }
      });
    });
  } else {
    // handle error case
  }
}
