import api from "@flatfile/api";
import { jobHandler } from "@flatfile/plugin-job-handler";
import { Simplified } from "@flatfile/util-common";


export default jobHandler("sheet:mergeRecords", async ({ context }, tick) => {
  const { jobId, sheetId } = context;

  try {
    const updates = [];
    const delete_ids = [];

    const records = await Simplified.getAllRecords(sheetId);
    
    // Group records by invoice number
    const groupedRecords = new Map();
    records.forEach((record) => {
      const invoice = record.invoice;
      if (!invoice) return;
      
      if (!groupedRecords.has(invoice)) {
        groupedRecords.set(invoice, []);
      }
      groupedRecords.get(invoice).push(record);
    });

    // Merge records with same invoice
    groupedRecords.forEach((group) => {
      if (group.length <= 1) return;

      // Use first record as base and merge others into it
      const mergedRecord = { ...group[0] };
      
      // Add remaining records' IDs to delete list and merge their fields
      for (let i = 1; i < group.length; i++) {
        const record = group[i];
        delete_ids.push(record._id);
        
        // Go through all fields in the record
        Object.keys(record).forEach(field => {
          // Skip _id field since we want to keep the first record's ID
          if (field === '_id') return;
          
          // If field doesn't exist or is empty/null in merged record,
          // take value from current record
          if (!mergedRecord[field] && record[field]) {
            mergedRecord[field] = record[field];
          }
        });
      }

      updates.push(mergedRecord);
    });
    if (updates.length > 0) {
      await Simplified.updateAllRecords(sheetId, updates as any);
    }
    if (delete_ids.length > 0) {
      await api.records.delete(sheetId, { ids: delete_ids });
    }
    await api.jobs.complete(jobId, { info: "Completed processing records" });
  } catch (error) {
    await api.jobs.fail(jobId, { info: "Failed processing records" });
  }
});
