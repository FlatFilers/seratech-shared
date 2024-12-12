import { JobOutcome } from "@flatfile/api/api";
import collect from "collect.js";
import { safe } from "../support/requests";
import { Item } from "../support/requests/records/item";
import { DocumentJobWorker, TriggeredBy } from "../support/utils/job.worker";

@TriggeredBy("transpose-execute")
export class TransposeExecute extends DocumentJobWorker {
  async execute(): Promise<JobOutcome> {
    const document = await this.document();

    const sheetId = extractIdFromDocument(document.body, "sheetId");
    console.log(`Found sheet ID: ${sheetId}`);

    const workbookId = extractIdFromDocument(document.body, "workbookId");
    console.log(`Found workbook ID: ${workbookId}`);

    // get the records (Column, Group Row, Key)
    const columns = await safe.records.stream({ sheetId });
    const groupedColumns: { [key: string]: { [key: string]: string } } = {};

    const oldColumns: string[] = [];

    columns
      .filter((r) => r.has("Group Row"))
      .each((column: Item) => {
        const groupRow = column.str("Group Row");
        const key = column.str("Key");
        const col = column.str("Column");
        const modifier = column.str("Group Modifier");
        if (groupRow && key) {
          if (!groupedColumns[groupRow]) {
            groupedColumns[groupRow] = { "--MODIFIER": modifier };
          }
          oldColumns.push(col);
          groupedColumns[groupRow][key] = col;
        }
      });

    const groups = Object.values(groupedColumns);
    console.log("Constructed groups: ", groups);

    const workbook = await safe.workbooks.get(workbookId);
    const dataSheetId = workbook.metadata.originalSheet;
    const originalData = await safe.records.stream({ sheetId: dataSheetId });

    const newRecords = collect(
      originalData.all().flatMap((r) => {
        return groups.map((group, index) => {
          const newRecord = r.copy();
          let hasValues = false;
          Object.entries(group).forEach(([key, col]) => {
            const value =
              key === "--MODIFIER" ? group["--MODIFIER"] : r.get(col);
            if (key === "--MODIFIER") {
              console.log("Group modifier: ", value, r.get("id"));
            }
            newRecord.set(key, value);
            newRecord.set(col, null);
            if (value) {
              hasValues = true;
            }
          });

          if (index !== 0 && !hasValues) {
            newRecord.delete();
          }

          return newRecord;
        });
      })
    );

    const originalSheet = await safe.sheets.get(dataSheetId);
    const originalWorkbook = await safe.workbooks.get(originalSheet.workbookId);
    const prevSheet = originalWorkbook.sheets.find((s) => s.id === dataSheetId);
    const newFields = prevSheet.config.fields.filter(
      (f) => !oldColumns.includes(f.key)
    );

    console.log(JSON.stringify(newFields.map((f) => f.key)));

    Object.keys(groups[0]).forEach((key) => {
      if (newFields.find((f) => f.key === key)) {
        return;
      }

      newFields.push({
        key,
        label: key,
        type: "string",
      });
    });

    await safe.workbooks.update(originalWorkbook.id, {
      sheets: [
        {
          ...prevSheet,
          config: {
            ...prevSheet.config,
            fields: newFields,
          },
        },
      ],
    });

    if (newRecords.count() > 0) {
      await safe.records.write(
        { sheetId: dataSheetId, silent: true, truncate: true },
        newRecords
      );
    }

    return {
      acknowledge: false,
      // @ts-ignore
      trigger: { type: "automatic_silent", audience: "all" },
      next: {
        type: "id",
        id: originalSheet.id,
      },
    };
  }
}

const extractIdFromDocument = (
  documentBody: string,
  idType: string
): string => {
  const idMatch = documentBody.match(new RegExp(`${idType}='(\\w+)'`));
  if (!idMatch) {
    throw new Error(`${idType} not found in the document embed syntax`);
  }
  return idMatch[1];
};
