import { ensureIndex, transitionGrnReceipt } from './mongo.js';

let receiptRequestIndex;

export async function ensureReceiptRequestIndex() {
  if (!receiptRequestIndex) {
    receiptRequestIndex = ensureIndex('grn', { central_request_id: 1 }, {
      name: 'uq_grn_central_request_id', unique: true,
      partialFilterExpression: { central_request_id: { $type: 'string', $gt: '' } },
    }).catch(error => { receiptRequestIndex = null; throw error; });
  }
  return receiptRequestIndex;
}

// Draft edits and receipt staging must contend on the same revision. A save
// that read the draft before staging may not overwrite the staged receipt.
export async function transitionGrnDraft(row, fields, expectedExtra = {}) {
  const revision = row?.draft_revision == null ? 0 : Number(row.draft_revision);
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) {
    throw Object.assign(new Error('Inbound draft revision is invalid. Reconcile the record before editing it.'), { status: 409 });
  }
  return transitionGrnReceipt(row.id,
    { ...row, draft_revision: row.draft_revision ?? null, ...expectedExtra },
    { ...fields, draft_revision: revision + 1 });
}
