// config/constants.js
module.exports = {
    // Application
    APP_NAME: 'MemoryGraph AI',
    VERSION: '1.0.0',

    // File Processing
    CHUNK_SIZE: 500,
    CHUNK_OVERLAP: 50,
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    SUPPORTED_FORMATS: ['.pdf', '.txt', '.md', '.json'],

    // Vector Database (Pinecone)
    PINECONE_INDEX_NAME: 'memorygraph-index',
    PINECONE_DIMENSION: 1536,
    PINECONE_METRIC: 'cosine',
    PINECONE_TOP_K: 5,

    // LLM (Groq)
    EMBEDDING_MODEL: 'llama3-embedding', // Check Groq docs for correct model name
    CHAT_MODEL: 'llama3-70b-8192',
    MAX_TOKENS: 2048,

    // Database (Supabase)
    SUPABASE_BUCKET: 'documents',

    // Graph
    GRAPH_MIN_CONFIDENCE: 0.7,

    // API Routes
    API_PREFIX: '/api/v1',

    // Status
    STATUS: {
        PROCESSING: 'processing',
        COMPLETED: 'completed',
        FAILED: 'failed'
    }
};