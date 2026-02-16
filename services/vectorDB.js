// services/vectorDB.js
const { Pinecone } = require('@pinecone-database/pinecone');
const logger = require('../utils/logger');
require('dotenv').config();

class VectorDB {
  constructor() {
    // CONFIG
    this.indexName = process.env.PINECONE_INDEX || 'memorygraph-index';
    this.dimension = 774;
    this.metric = 'cosine';
    this.topK = 5;

    // STATE
    this.pinecone = null;
    this.index = null;

    // INTERNAL LOCK (VERY IMPORTANT)
    this._initializing = null;
  }

  /* ---------------- INIT CORE ---------------- */

  async initialize() {
    // Already initialized
    if (this.index) return;

    // Someone else is initializing → wait
    if (this._initializing) {
      await this._initializing;
      return;
    }

    // First initializer
    this._initializing = (async () => {
      if (!process.env.PINECONE_API_KEY) {
        throw new Error('PINECONE_API_KEY not found in environment variables');
      }

      this.pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
      });

      logger.info('Pinecone client created');

      await this.ensureIndexExists();

      this.index = this.pinecone.index(this.indexName);
      logger.info(`✅ Connected to Pinecone index: ${this.indexName}`);
    })();

    await this._initializing;
  }

  async ensureReady() {
    await this.initialize();
  }

  /* ---------------- INDEX ---------------- */

  async ensureIndexExists() {
    const indexes = await this.pinecone.listIndexes();
    const exists = indexes.indexes?.some(i => i.name === this.indexName);

    if (exists) {
      logger.info(`✅ Index exists: ${this.indexName}`);
      return;
    }

    logger.info(`Creating index: ${this.indexName}`);

    await this.pinecone.createIndex({
      name: this.indexName,
      dimension: this.dimension,
      metric: this.metric,
      spec: {
        serverless: {
          cloud: 'aws',
          region: 'us-east-1',
        },
      },
      waitUntilReady: true,
      suppressConflicts: true,
    });

    logger.info(`✅ Index created: ${this.indexName}`);
  }

  /* ---------------- VECTORS ---------------- */

  async upsertVector(vector, metadata) {
    await this.ensureReady();

    const vectorId = `vec_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    await this.index.upsert([{
      id: vectorId,
      values: vector,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
        dimension: vector.length,
      },
    }]);

    return vectorId;
  }

  async upsertVectorsBatch(vectors, metadatas) {
    await this.ensureReady();

    const payload = vectors.map((vector, i) => ({
      id: `vec_${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`,
      values: vector,
      metadata: {
        ...metadatas[i],
        timestamp: new Date().toISOString(),
        dimension: vector.length,
      },
    }));

    await this.index.upsert(payload);
    return payload.map(v => v.id);
  }

  async queryVector(queryVector, topK = null, filter = null) {
    await this.ensureReady();

    const res = await this.index.query({
      vector: queryVector,
      topK: topK || this.topK,
      includeMetadata: true,
      includeValues: false,
      filter,
    });

    return res.matches || [];
  }

  /* ---------------- DELETE ---------------- */

  async deleteVector(vectorId) {
    await this.ensureReady();
    await this.index.deleteOne(vectorId);
  }

  async deleteVectorsByFilter(filter) {
    await this.ensureReady();
    await this.index.deleteMany(filter);
  }

  async deleteAllVectors() {
    await this.ensureReady();
    await this.index.deleteAll();
  }

  /* ---------------- STATS ---------------- */

  async getIndexStats() {
    await this.ensureReady();
    return await this.index.describeIndexStats();
  }

  // Add to your VectorDB class
  // Add to your VectorDB class
  async deleteAllUserVectors(userId) {
    await this.ensureReady();
    try {
    
      await this.index.deleteMany({
        filter: { userId: userId }  // Simple format, no $eq
      });
      logger.info(`Deleted all vectors for user: ${userId}`);
    } catch (error) {
      logger.error(`Error deleting user vectors:`, error);
      throw error;
    }
  }

  async healthCheck() {
    try {
      const stats = await this.getIndexStats();
      return {
        healthy: true,
        index: this.indexName,
        vectorCount: stats.totalVectorCount,
        dimension: this.dimension,
        metric: this.metric,
      };
    } catch (err) {
      return { healthy: false, error: err.message };
    }
  }

  /* ---------------- NAMESPACE ---------------- */

  async namespaceExists(namespace = '') {
    await this.ensureReady();
    const stats = await this.index.describeIndexStats();
    return stats.namespaces?.[namespace] !== undefined;
  }

  async deleteNamespace(namespace) {
    await this.ensureReady();
    await this.index.namespace(namespace).deleteAll();
    return true;
  }
}

// SINGLETON EXPORT
module.exports = new VectorDB();
