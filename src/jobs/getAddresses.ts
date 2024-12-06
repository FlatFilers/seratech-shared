import api from "@flatfile/api";
import { jobHandler } from "@flatfile/plugin-job-handler";
import { Simplified } from "@flatfile/util-common";
import apiV2Alpha from "../lib/api-v2-alpha";

export default jobHandler("sheet:getAddresses", async ({ context }, tick) => {
  const { jobId, sheetId, workbookId } = context;

  try {
    const updates = [];

    const records = await Simplified.getAllRecords(sheetId);

    const { data: sheets } = await api.sheets.list({ workbookId });
    const loactionsSheet = sheets.find((sheet) => sheet.slug === "locations");

    if (!loactionsSheet) {
      throw new Error("Locations sheet not found.");
    }

    const locationsRecords = await apiV2Alpha.records.list(
      workbookId,
      {},
      { query: { sheetId: loactionsSheet.id } },
    );

    locationsRecords.forEach((record) => {
      const newRecord: Record<string, any> = { _id: record._id };
      let updateRecord = false;

      const customerName = record.customer_name;
      const address1 = record.address_1;
      const address2 = record.address_2;
      const city = record.city;
      const state = record.state_province;
      const zip = record.zip_postal_code;
      const notes = record.notes;
      const locationName = record.location_name;
      const primaryLocation = record.primary_location;

      if (primaryLocation == "No") {
        // Find matching customer record
        const matchingRecord = records.find(
          (r) => r.displayName === customerName,
        );

        if (matchingRecord) {
          // Find first empty address field
          for (let i = 1; i <= 35; i++) {
            const addressKey = `address${i}StreetLine1`;
            if (!matchingRecord[addressKey]) {
              if (
                updates.find(
                  (r) => r._id === matchingRecord._id && r[addressKey],
                )
              ) {
                continue;
              } else {
                // Found empty address field, update it
                let combinedNotes = "";
                if (locationName && notes) {
                  combinedNotes = `Location Name: ${locationName}, Gate Access Instructions: ${notes}`;
                } else if (notes) {
                  combinedNotes = `Gate Access Instructions: ${notes}`;
                } else if (locationName) {
                  combinedNotes = `Location Name: ${locationName}`;
                } else if (!notes && !locationName) {
                  combinedNotes = "";
                }
                const updatedRecord = {
                  _id: matchingRecord._id,
                  [`address${i}StreetLine1`]: address1,
                  [`address${i}StreetLine2`]: address2,
                  [`address${i}City`]: city,
                  [`address${i}State`]: state,
                  [`address${i}PostalCode`]: zip,
                  [`address${i}Notes`]: combinedNotes,
                };
                const existingUpdate = updates.find(
                  (u) => u._id === updatedRecord._id,
                );
                if (existingUpdate) {
                  const { _id, ...recordWithoutId } = updatedRecord;
                  Object.assign(existingUpdate, recordWithoutId);
                } else {
                  updates.push(updatedRecord);
                }

                updateRecord = true;
                break;
              }
            }
          }
        }
      }
    });
    if (updates.length > 0) {
      await Simplified.updateAllRecords(sheetId, updates as any);
    }
    await api.jobs.complete(jobId, { info: "Completed processing records" });
  } catch (error) {
    await api.jobs.fail(jobId, { info: "Failed processing records" });
  }
});
