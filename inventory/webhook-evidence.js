// Called only inside the signed-ingress transaction, after acceptance. Receipt
// of an inventory or refund callback must not establish order delivery.
export function validateWebhookOrderIdentity(event) {
  const id = event?.id;
  const valid = typeof id === 'number'
    ? Number.isSafeInteger(id) && id > 0
    : typeof id === 'string' && id.trim().length > 0 && id.length <= 120;
  if (!valid) throw Object.assign(new Error('Webhook order identity is missing or invalid'), { status: 400 });
}

export async function recordOrderWebhookEvidence(db, { tenantId, accountId, platform, topic }) {
  const orderTopic = platform === 'shopify'
    ? ['orders/create', 'orders/updated', 'orders/cancelled'].includes(topic)
    : platform === 'woocommerce' && ['order.created', 'order.updated'].includes(topic);
  if (!orderTopic) return;
  const result = await db.query(
    "UPDATE ci_channel_account SET settings=settings||jsonb_build_object('lastOrderWebhookAt',clock_timestamp()),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND platform=$3 RETURNING id",
    [tenantId, accountId, platform],
  );
  if (!result.rowCount) throw Object.assign(new Error('Webhook account ownership changed'), { status: 409 });
}
