export function persistenceRequired(){
  return process.env.NODE_ENV==='production'||process.env.DMILLS_REQUIRE_PERSISTENCE==='true';
}
