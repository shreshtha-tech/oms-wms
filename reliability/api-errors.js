// Database faults must not be downgraded to validation errors or expose SQL,
// constraint detail, connection strings, or the rejected row's contents.
export function sendDatabaseError(res, error) {
 let status, code, message;
 if (error?.code === 'DATABASE_COMMIT_UNCERTAIN') {
  status=503;code=error.code;message='The transaction commit outcome is unknown. Preserve the request identity and reconcile its result before retrying.';
 } else if (error?.code === 'DATABASE_UNAVAILABLE') {
  status=503;code=error.code;message='The database dependency is temporarily unavailable.';
 } else if (error?.code === 'DATABASE_TIMEOUT') {
  status=504;code=error.code;message='The database operation timed out. Please try again.';
 } else if (/^[0-9][0-9A-Z]{4}$/.test(String(error?.code || ''))) {
  if (['23505','23P01'].includes(error.code)) {status=409;code='DATABASE_CONFLICT';message='The operation conflicts with an existing record.';}
  else if (['23503','23514','23502'].includes(error.code)) {status=422;code='DATABASE_INTEGRITY_REJECTED';message='The operation violates a data integrity requirement.';}
  else {status=500;code='DATABASE_OPERATION_FAILED';message='The database operation could not be completed.';}
 } else return false;
 res.status(status).json({error:code,message,...(error.database?{database:error.database}:{})});
 return true;
}
