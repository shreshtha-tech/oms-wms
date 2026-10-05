import { randomBytes } from 'node:crypto';
import { sendDatabaseUnavailable, cors, find, findOne, insert, remove, actor } from './mongo.js';

const MODULE = 'attribute-set';
const text = (value) => String(value ?? '').trim();
const fail = (res, status, error) => res.status(status).json({ error });

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    if (req.method === 'GET') {
      const rows = await find('generic_records', { module: MODULE }, { sort: { id: -1 } });
      return res.status(200).json({ rows });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const description = text(body.description);
      const externalCode = text(body.externalCode);
      const active = body.active === undefined ? true : body.active;
      if (!description) return fail(res, 400, 'Attribute Set Description is mandatory.');
      if (description.length > 1000 || externalCode.length > 100) return fail(res, 400, 'Attribute Set Description or external code is too long.');
      if (typeof active !== 'boolean') return fail(res, 400, 'Is Active must be true or false.');

      const rows = await find('generic_records', { module: MODULE });
      const existingCodes = new Set(rows.map((row) => text(row.code).toLocaleLowerCase('en')));
      let code;
      do {
        code = `AS${Date.now().toString(36).toLocaleUpperCase('en')}${randomBytes(4).toString('hex').toLocaleUpperCase('en')}`;
      } while (existingCodes.has(code.toLocaleLowerCase('en')));

      const username = actor(req);
      const date = new Date().toISOString().slice(0, 10);
      const record = {
        module: MODULE,
        code,
        name: description,
        description,
        status: active ? 'Active' : 'Inactive',
        extra: { external_code: externalCode },
        created_by: username,
        created_date: date,
        updated_by: username,
        updated_date: date,
      };
      return res.status(201).json(await insert('generic_records', record));
    }

    if (req.method === 'DELETE') {
      const id = Number(req.body?.id);
      if (!Number.isSafeInteger(id) || id <= 0) return fail(res, 400, 'A valid Attribute Set ID is required.');
      const current = await findOne('generic_records', { id });
      if (!current || current.module !== MODULE) return fail(res, 404, 'Attribute Set not found.');
      await remove('generic_records', id);
      return res.status(200).json({ ok: true, id });
    }

    return fail(res, 405, 'Method not allowed.');
  } catch (error) {
    if (sendDatabaseUnavailable(res, error)) return;
    console.error('Attribute Sets API error:', { name: error?.name, code: error?.code });
    return fail(res, 500, error.message || 'Attribute Set request failed.');
  }
}
