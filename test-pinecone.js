// test-pinecone.js - Test Pinecone connection
require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');

async function testPinecone() {
  try {
    console.log('🔧 Testing Pinecone connection...');
    console.log('API Key exists:', !!process.env.PINECONE_API_KEY);
    console.log('Index Name:', process.env.PINECONE_INDEX_NAME);
    console.log('Environment:', process.env.PINECONE_ENVIRONMENT);
    
    // Check if .env is loaded
    if (!process.env.PINECONE_API_KEY) {
      console.error('❌ PINECONE_API_KEY not found in .env file');
      console.log('Make sure your .env file has:');
      console.log('PINECONE_API_KEY=pc-xxxx...');
      console.log('PINECONE_INDEX_NAME=memorygraph-index');
      console.log('PINECONE_ENVIRONMENT=us-east-1-aws');
      return;
    }
    
    const pc = new Pinecone({ 
      apiKey: process.env.PINECONE_API_KEY 
    });
    
    console.log('\n🔄 Connecting to Pinecone...');
    const index = pc.index(process.env.PINECONE_INDEX_NAME);
    
    // Get index stats
    const stats = await index.describeIndexStats();
    console.log('\n✅ PINEVONE CONNECTED SUCCESSFULLY!');
    console.log('📊 Index Stats:', {
      dimension: stats.dimension,
      totalVectors: stats.totalVectorCount,
      indexFullness: stats.indexFullness
    });
    
    // Test: Insert a simple vector
    console.log('\n🧪 Testing vector insertion...');
    const testVector = Array(1536).fill(0.1); // Create 1536 numbers
    await index.upsert([{
      id: 'test-vector-1',
      values: testVector,
      metadata: { 
        test: true, 
        message: 'Hello from MemoryGraph AI',
        timestamp: new Date().toISOString() 
      }
    }]);
    console.log('✅ Test vector inserted!');
    
    // Test: Search for it
    console.log('\n🔍 Testing similarity search...');
    const queryResult = await index.query({
      vector: testVector,  // Search with same vector
      topK: 3,
      includeMetadata: true
    });
    
    console.log('✅ Search working! Found:', queryResult.matches.length, 'matches');
    if (queryResult.matches.length > 0) {
      console.log('Top match ID:', queryResult.matches[0].id);
      console.log('Top match score:', queryResult.matches[0].score.toFixed(4));
    }
    
    // Clean up: Delete test vector
    console.log('\n🧹 Cleaning up test vector...');
    await index.deleteOne('test-vector-1');
    console.log(' Test completed and cleaned up!');
    
  } catch (error) {
    console.error('\n PINEVONE TEST FAILED!');
    console.error('Error:', error.message);
    console.log('\n Common fixes:');
    console.log('1. Check PINECONE_API_KEY in .env file');
    console.log('2. Make sure index "memorygraph-index" exists');
    console.log('3. Check PINECONE_ENVIRONMENT in .env');
    console.log('4. Your .env should have:');
    console.log('   PINECONE_API_KEY=pc-xxxx...');
    console.log('   PINECONE_INDEX_NAME=memorygraph-index');
    console.log('   PINECONE_ENVIRONMENT=us-east-1-aws');
  }
}

testPinecone();