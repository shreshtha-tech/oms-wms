import assert from 'node:assert/strict';
import express from 'express';
import { requestTelemetry, latencySnapshot, metricSnapshot } from '../reliability/telemetry.js';
const app = express();
app.use(requestTelemetry);
app.get('/instrumentation/:id', (_req, res) => res.status(204).end());
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  // Three fixed workers; no unbounded concurrent request creation.
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < 12) {
      const index = next++;
      const response = await fetch(`${base}/instrumentation/private-object-${index}?credential=private-query`, { headers: { 'x-request-id': `fixture-request-${index}` }, signal: AbortSignal.timeout(2000) });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('x-request-id'), `fixture-request-${index}`);
    }
  }));
  const histogram = latencySnapshot().find(row => row.name === 'http_duration_ms');
  assert.equal(histogram.count, 12);
  assert.equal(histogram.labels.route, '/instrumentation/:id');
  assert.equal(histogram.labels.method, 'GET');
  assert.ok(histogram.sumMs >= 0 && histogram.maxMs >= 0);
  assert.equal(metricSnapshot().find(row => row.name === 'http_requests_total').value, 12);
  const labels = JSON.stringify({ histograms: latencySnapshot(), metrics: metricSnapshot() });
  assert.ok(!labels.includes('private-object') && !labels.includes('private-query'));
  console.log('PASS: 12 completed HTTP requests produce 12 histogram samples; three-worker traffic retains matched route labels without object/query values.');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
