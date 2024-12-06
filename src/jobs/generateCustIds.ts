import api from "@flatfile/api";
import { jobHandler } from "@flatfile/plugin-job-handler";
import { Simplified } from "@flatfile/util-common";

export default jobHandler("sheet:generateCustIds", async ({ context }, tick) => {
  const { jobId, sheetId, workbookId } = context;

  try {
    const updates = [];
    const delete_ids = [];

    const records = await Simplified.getAllRecords(sheetId);

    records.forEach((record) => {
      const newRecord: Record<string, any> = { _id: record._id };
      let updateRecord = false;

      const customerId = record.id;
      if (!customerId) {
        const firstName = record.firstName as string || '';
        const numpadMap: {[key: string]: string} = {
          'a': '2', 'b': '2', 'c': '2',
          'd': '3', 'e': '3', 'f': '3', 
          'g': '4', 'h': '4', 'i': '4',
          'j': '5', 'k': '5', 'l': '5',
          'm': '6', 'n': '6', 'o': '6',
          'p': '7', 'q': '7', 'r': '7', 's': '7',
          't': '8', 'u': '8', 'v': '8',
          'w': '9', 'x': '9', 'y': '9', 'z': '9'
        };
        
        // Get first 5 chars of firstName and convert to numpad numbers
        const baseId = firstName.toLowerCase().slice(0,5)
          .split('')
          .map(c => numpadMap[c] || '0')
          .join('');

        // Find existing IDs with same base from both records and pending updates
        const existingIds = [
          ...records.map(r => r.id?.toString() || ''),
          ...updates.map(r => r.id?.toString() || '')
        ]
          .filter(id => id.startsWith(baseId))
          .map(id => parseInt(id.slice(-3)));

        const seq = existingIds.length ? Math.max(...existingIds) + 1 : 1;
        newRecord["id"] = parseInt(baseId + seq.toString().padStart(3,'0'));
        updateRecord = true;
      }
      if (updateRecord) {
        updates.push(newRecord);
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
