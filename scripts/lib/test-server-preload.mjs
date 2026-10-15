// IPC announces the actual OS-assigned HTTP port; runtime server stays unchanged.
import { Server } from 'node:net';
if (process.env.NODE_ENV !== 'test' || process.env.DMILLS_SKIP_DOTENV !== 'true' || process.env.PORT !== '0' || !process.send) throw new Error('Test server preload requires an isolated IPC child');
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  this.once('listening', () => {
    const address = this.address();
    if (address && typeof address === 'object') process.send({ type: 'test-server-listening', port: address.port });
  });
  return listen.apply(this, args);
};
