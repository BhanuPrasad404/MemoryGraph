// services/aiService.js - CLEANED VERSION
const Groq = require('groq-sdk');
const axios = require('axios');
const logger = require('../utils/logger');
require('dotenv').config();

class AIService {
    constructor() {
        try {
            // Initialize Groq for chat
            this.groq = new Groq({
                apiKey: process.env.GROQ_API_KEY
            });

            // Gemini for embeddings
            this.geminiApiKey = process.env.GEMINI_API_KEY;
            this.embeddingDimension = 768; // Must match Pinecone
            this.chatModel = "llama-3.3-70b-versatile";
            this.maxTokens = 2048;

            logger.info('✅ AI Service initialized (Groq Chat + Gemini Embeddings)');

            // Validate API keys
            if (!process.env.GROQ_API_KEY) {
                logger.warn('⚠️ GROQ_API_KEY not set - chat will fail');
            }
            if (!this.geminiApiKey) {
                logger.warn('⚠️ GEMINI_API_KEY not set - embeddings will fail');
            }

        } catch (error) {
            logger.error('❌ AI Service initialization failed:', error);
            throw error;
        }
    }

    async generateEmbedding(text) {
        try {
            if (!this.geminiApiKey) {
                throw new Error('GEMINI_API_KEY not configured');
            }

            logger.info(`Generating embedding for text (${text.length} chars)...`);

            // Gemini Embeddings API (text-embedding-004)
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.geminiApiKey}`,
                {
                    content: {
                        parts: [{ text: text }]
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Extract embedding from response
            const embedding = response.data.embedding?.values;

            if (!embedding || embedding.length !== this.embeddingDimension) {
                logger.warn(`Embedding dimension mismatch: ${embedding?.length} vs ${this.embeddingDimension}`);
                throw new Error('Invalid embedding from Gemini');
            }

            logger.info(` Embedding generated (${embedding.length} dimensions)`);
            return embedding;

        } catch (error) {
            logger.error('Gemini embedding error:', error);

            // Fallback: return random embedding (for development only)
            const fallback = Array(this.embeddingDimension)
                .fill(0)
                .map(() => (Math.random() - 0.5) * 0.1); // Small random values

            logger.warn('⚠️ Using fallback embedding (random vector)');
            return fallback;
        }
    }

    async generateEmbeddingsBatch(texts) {
        try {
            logger.info(`Generating batch embeddings for ${texts.length} texts...`);

            // If no texts, return empty array
            if (!texts || texts.length === 0) {
                return [];
            }

            // If only 1 text, just process it directly
            if (texts.length === 1) {
                const singleEmbedding = await this.generateEmbedding(texts[0]);
                return [singleEmbedding];
            }

            const embeddings = [];
            const batchSize = 10; // 10 chunks per batch

            // Log chunk sizes for debugging
            logger.debug(`Chunk sizes: ${texts.map(t => t.length).join(', ')}`);
            logger.debug(`Average chunk size: ${Math.round(texts.reduce((sum, t) => sum + t.length, 0) / texts.length)} chars`);

            // Process in batches
            for (let batchIndex = 0; batchIndex < texts.length; batchIndex += batchSize) {
                const batchNumber = Math.floor(batchIndex / batchSize) + 1;
                const totalBatches = Math.ceil(texts.length / batchSize);

                const currentBatch = texts.slice(batchIndex, batchIndex + batchSize);

                logger.info(` Processing batch ${batchNumber}/${totalBatches} (chunks ${batchIndex}-${Math.min(batchIndex + batchSize - 1, texts.length - 1)})`);

                // Process each chunk in this batch
                const batchPromises = currentBatch.map(async (text, indexInBatch) => {
                    const chunkNumber = batchIndex + indexInBatch;
                    logger.debug(`  → Chunk ${chunkNumber + 1}/${texts.length} (${text.length} chars)`);

                    return await this.generateEmbedding(text);
                });

                // Wait for all embeddings in this batch
                const batchEmbeddings = await Promise.all(batchPromises);
                embeddings.push(...batchEmbeddings);

                logger.info(` Batch ${batchNumber} completed: ${batchEmbeddings.length} embeddings`);

                // Add delay between batches (except after last batch)
                if (batchIndex + batchSize < texts.length) {
                    const delayMs = 1000; // 1 second delay
                    logger.debug(` Waiting ${delayMs}ms before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }

            logger.info(` TOTAL: ${embeddings.length} embeddings generated successfully`);

            // Verify all embeddings have correct dimension
            const validEmbeddings = embeddings.filter(emb =>
                emb && Array.isArray(emb) && emb.length === this.embeddingDimension
            );

            if (validEmbeddings.length !== embeddings.length) {
                logger.warn(`${embeddings.length - validEmbeddings.length} invalid embeddings filtered out`);
            }

            return validEmbeddings;

        } catch (error) {
            logger.error('Batch embeddings error:', error);

            // If partial success, return what we have
            if (embeddings && embeddings.length > 0) {
                logger.warn(`Returning ${embeddings.length} partial embeddings`);
                return embeddings;
            }

            throw error;
        }
    }
    async chatCompletion(messages, temperature = 0.7) {
        try {
            logger.info(`Chat completion (${messages.length} messages)`);
            const recentMessages = messages.slice(-10)

            const completion = await this.groq.chat.completions.create({
                messages: recentMessages,
                model: this.chatModel,
                temperature: temperature,
                max_tokens: this.maxTokens,
                stream: false
            });

            const response = completion.choices[0]?.message?.content || '';
            logger.info(` Chat response: ${response.substring(0, 100)}...`);
            return response;

        } catch (error) {
            logger.error('Groq chat error:', error);
            throw new Error(`Chat failed: ${error.message}`);
        }
    }

    async ragCompletion(query, contextChunks, memoryContext = null) {
        try {
            logger.info(`RAG query: "${query.substring(0, 50)}..."`);

            // 1. Prepare context from retrieved chunks
            const context = contextChunks
                .map((chunk, i) => `[Source ${i + 1}]: ${chunk.content}`)
                .join('\n\n');

            // 2. Build system prompt WITH memory context
            let systemPrompt = `You are MemoryGraph AI - the world's first RAG + Knowledge Graph assistant and please don't always like a bot you are intelligent Assitant to the user and don't always say from my knowledge graph like that please answer like a pro.

RULES:
1. Answer using ONLY the context below
2. If unsure, say: "Based on my knowledge graph..."
3. Connect concepts using your memory graph
4. Be insightful and show connections
5. And maniley don't inclide the sources like this [Source 1] [Source 2].... in the response it is weired your answer is like powered with intelligence not like a bot please
6.You are the intelligent Assitant for the User so Answer like a pro and Anlyze and give deeper insights with good representation of the each answer 

CONTEXT FROM DOCUMENTS:
${context}`;

            // 3. ADD MEMORY GRAPH CONTEXT (THE KILLER FEATURE!)
            if (memoryContext && memoryContext.concepts && memoryContext.concepts.length > 0) {
                systemPrompt += `\n\nKNOWLEDGE GRAPH CONTEXT (Your secret weapon!):
The user's memory graph contains these related concepts:`;

                memoryContext.concepts.forEach(concept => {
                    systemPrompt += `\n- ${concept.name} (${concept.type})`;
                    if (concept.description) {
                        systemPrompt += `: ${concept.description}`;
                    }
                });

                systemPrompt += `\n\nUse this graph knowledge to provide richer, more connected answers!`;
            }

            // 4. Add citation instructions
            //systemPrompt += `\n\nCITE YOUR SOURCES: Use [Source X] when referencing document content.`;

            const messages = [
                {
                    role: 'system',
                    content: systemPrompt  // NOW IT'S A PROPER STRING WITH MEMORY CONTEXT!
                },
                {
                    role: 'user',
                    content: query
                }
            ];

            // 5. Debug: log what we're sending
            logger.debug('System prompt length:', systemPrompt.length);
            logger.debug('First 200 chars:', systemPrompt.substring(0, 200));

            return await this.chatCompletion(messages, 0.3);

        } catch (error) {
            logger.error('RAG completion error:', error);
            throw error;
        }
    }

    /** ---------------- EMBED QUERY (SAME AS DOCUMENTS) ---------------- **/

    async embedQuery(query) {
        // Use the SAME embedding function for consistency!
        return await this.generateEmbedding(query);
    }

    /** ---------------- UTILITIES ---------------- **/

    async extractEntities(text) {
        try {
            const prompt = `Extract key entities from text. Return JSON array with: name, type (person/organization/concept/topic/location), relevance (1-10).

Text: "${text.substring(0, 1000)}..."

Format: [{"name": "string", "type": "string", "relevance": number}]`;

            const messages = [
                { role: 'system', content: 'Return ONLY valid JSON.' },
                { role: 'user', content: prompt }
            ];

            const response = await this.chatCompletion(messages, 0.1);

            try {
                return JSON.parse(response);
            } catch {
                logger.warn('Failed to parse entities JSON');
                return [];
            }

        } catch (error) {
            logger.error('Entity extraction error:', error);
            return [];
        }
    }

    async summarizeText(text, maxLength = 500) {
        try {
            const prompt = `Summarize in ${maxLength} characters: ${text.substring(0, 3000)}...`;

            const messages = [
                { role: 'system', content: 'Provide concise, accurate summary.' },
                { role: 'user', content: prompt }
            ];

            return await this.chatCompletion(messages, 0.2);

        } catch (error) {
            logger.error('Summarization error:', error);
            return 'Summary generation failed.';
        }
    }

    /** ---------------- HEALTH CHECK ---------------- **/

    async healthCheck() {
        const checks = {
            groq: { healthy: false, error: null },
            gemini: { healthy: false, error: null }
        };

        try {
            // Test Groq
            await this.groq.chat.completions.create({
                messages: [{ role: 'user', content: 'Hi' }],
                model: 'llama3-8b-8192',
                max_tokens: 5
            });
            checks.groq.healthy = true;
        } catch (error) {
            checks.groq.error = error.message;
        }

        try {
            // Test Gemini
            const testEmbedding = await this.generateEmbedding('test');
            if (testEmbedding && testEmbedding.length === this.embeddingDimension) {
                checks.gemini.healthy = true;
            }
        } catch (error) {
            checks.gemini.error = error.message;
        }

        const allHealthy = checks.groq.healthy && checks.gemini.healthy;

        return {
            healthy: allHealthy,
            services: checks,
            embeddingDimension: this.embeddingDimension,
            chatModel: this.chatModel
        };
    }
}

module.exports = new AIService();