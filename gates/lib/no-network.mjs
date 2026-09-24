// Preload (node --import) that makes any network access throw: proves a pipeline reads only its cache.
import net from 'node:net';
import tls from 'node:tls';
const deny = ( what ) => () => { throw new Error( `network access blocked (${ what })` ); };
globalThis.fetch = async () => { throw new Error( 'network access blocked (fetch)' ); };
net.connect = net.createConnection = deny( 'net.connect' );
tls.connect = deny( 'tls.connect' );
