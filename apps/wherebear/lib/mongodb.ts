import { MongoClient, Db } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'wherebear';

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient> | undefined;

/** Lazy connection: compiling this independent app must not connect to a live
 * store or start work. The URI and database are fixed by the deployment, never
 * selected from the incoming request. Keep WhereBear's existing Atlas database
 * and search indexes; other stores must have their own database credentials.
 */
function getClient(): Promise<MongoClient> {
  if (!uri) throw new Error('MONGODB_URI is not configured');
  if (process.env.NODE_ENV === 'development') {
    global._mongoClientPromise ??= new MongoClient(uri).connect();
    return global._mongoClientPromise;
  }
  clientPromise ??= new MongoClient(uri).connect();
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(dbName);
}
