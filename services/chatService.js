// services/chatService.js - UPDATED WITH ONLY NEW STUFF
const aiService = require('./aiService');
const vectorDB = require('./vectorDB');
//const supabaseService = require('./supabaseService');
const logger = require('../utils/logger');
const memoryGraph = require('./memoryGraph');
const supabaseService = require('./supabaseService');
const supabase = supabaseService.supabase;

class ChatService {
    constructor() {
        logger.info('ChatService initialized');
    }

    // ========== NEW METHOD: saveMessage ==========
    async saveMessage(userId, documentId, sessionId, role, content, metadata = {}) {
        try {
            const messageData = {
                user_id: userId,
                document_id: documentId || null,
                session_id: sessionId,
                role: role,
                content: content,
                model: metadata.model || (role === 'user' ? 'user_input' : 'groq-llama'),
                tokens_used: metadata.tokens || 0,
                metadata: metadata
            };

            const { data, error } = await supabase
                .from('chat_messages')
                .insert([messageData])
                .select()
                .single();

            if (error) throw error;

            logger.info(`✅ ${role.toUpperCase()} message saved to DB: ${data.id}`);
            return { success: true, data };

        } catch (error) {
            logger.error(`❌ Failed to save ${role} message:`, error);
            return { success: false, error };
        }
    }

    /**
     * Process a user query with RAG
     */
    async processQuery(query, userId, options = {}) {
        const startTime = Date.now();

        try {
            logger.info(`Processing query for user ${userId}: "${query.substring(0, 50)}..."`);

            const {
                documentId = null,
                session_id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // ADDED
                topK = 5,
                temperature = 0.3,
                includeSources = true,
                includeGraph = false
            } = options;


            const userSaveResult = await this.saveMessage(
                userId,
                documentId,
                session_id,
                'user',
                query,
                {
                    type: documentId ? 'document_chat' : 'global_chat',
                    query_length: query.length,
                    document_id: documentId
                }
            );

            if (!userSaveResult.success) {
                logger.warn('Failed to save user message, continuing anyway...');
            }

            /*
               STEP 0.5: MEMORY GRAPH RETRIEVAL (ADDITIVE ONLY)
            */
            let memoryContext = null;
            try {
                memoryContext = await memoryGraph.findRelatedConcepts(query, userId);
                logger.info(
                    `Memory graph concepts found: ${memoryContext?.concepts?.length || 0}`
                );
            } catch (err) {
                logger.warn('Memory graph retrieval failed:', err.message);
            }

            // STEP 1: Generate embedding for the query
            logger.info('Step 1: Generating query embedding...');
            const queryEmbedding = await aiService.generateEmbedding(query);

            //  Prepare filter for Pinecone search
            let filter = {};
            if (documentId) {
                // Search only within specific document
                filter = { document_id: documentId };
                logger.info(`Searching only in document: ${documentId}`);
            } else {
                // Search across all user's documents
                logger.info('Searching across all documents');
            }

            // STEP 3: Search Pinecone for similar chunks
            logger.info(`Step 2: Searching Pinecone (topK: ${topK})...`);
            const vectorResults = await vectorDB.queryVector(
                queryEmbedding,
                topK,
                documentId ? filter : null
            );

            if (!vectorResults || vectorResults.length === 0) {
                logger.warn('No relevant chunks found in vector search');

                // ========== NEW: SAVE NO RESULTS RESPONSE ==========
                await this.saveMessage(
                    userId,
                    documentId,
                    session_id,
                    'assistant',
                    "I couldn't find relevant information in your documents to answer this question. Try uploading more documents or asking a different question.",
                    {
                        type: documentId ? 'document_chat' : 'global_chat',
                        chunks_used: 0,
                        no_results: true
                    }
                );

                return this.getNoResultsResponse(query, session_id);
            }

            logger.info(`Found ${vectorResults.length} relevant chunks`);

            // STEP 4: Get chunk details from Supabase
            logger.info('Step 3: Retrieving chunk details...');
            const contextChunks = [];
            for (const result of vectorResults) {
                try {
                    const vectorId = result.id;
                    const chunk = await supabaseService.getChunkByVectorId(vectorId);

                    if (chunk) {
                        contextChunks.push({
                            ...chunk,
                            similarity: result.score,
                            vector_id: vectorId
                        });
                    }
                } catch (error) {
                    logger.warn(`Failed to get chunk for vector ${result.id}:`, error.message);
                }
            }

            if (contextChunks.length === 0) {
                logger.warn('No chunk details retrieved');

                // ========== NEW: SAVE RETRIEVAL ERROR ==========
                await this.saveMessage(
                    userId,
                    documentId,
                    session_id,
                    'assistant',
                    "I found some content but couldn't retrieve the details. Please try again.",
                    {
                        type: documentId ? 'document_chat' : 'global_chat',
                        chunks_used: 0,
                        retrieval_error: true
                    }
                );

                return this.getNoResultsResponse(query, session_id); // UPDATED
            }

            logger.info(`Retrieved ${contextChunks.length} chunk details`);

            // STEP 5: Generate answer using RAG (MEMORY-INJECTED)
            logger.info('Step 4: Generating RAG answer...');
            const answer = await aiService.ragCompletion(
                query,
                contextChunks.map(c => ({
                    content: c.content,
                    metadata: {
                        chunk_id: c.id,
                        document_id: c.document_id,
                        similarity: c.similarity
                    }
                })),
                memoryContext
            );

            // ========== NEW: SAVE AI RESPONSE ==========
            const aiSaveResult = await this.saveMessage(
                userId,
                documentId,
                session_id,
                'assistant',
                answer,
                {
                    type: documentId ? 'document_chat' : 'global_chat',
                    chunks_used: contextChunks.length,
                    top_k: topK,
                    has_memory_context: !!memoryContext,
                    memory_concepts_count: memoryContext?.concepts?.length || 0,
                    sources: includeSources ? this.formatSources(contextChunks) : []
                }
            );

            if (!aiSaveResult.success) {
                logger.warn('Failed to save AI message');
            }

            //Prepare response
            const response = {
                success: true,
                query: query,
                answer: answer,
                session_id: session_id, // ADDED
                metadata: {
                    processing_time: Date.now() - startTime,
                    chunks_used: contextChunks.length,
                    top_k: topK,
                    document_filter: documentId
                }
            };

            // Add sources if requested
            if (includeSources) {
                response.sources = this.formatSources(contextChunks);
            }

            // Add graph data if requested (REAL MEMORY GRAPH)
            if (includeGraph && memoryContext?.graph) {
                response.graph = memoryContext.graph;
            }

            logger.info(` Query processed successfully in ${response.metadata.processing_time}ms`);
            return response;

        } catch (error) {
            logger.error('Query processing failed:', error);

            // ========== NEW: SAVE ERROR MESSAGE ==========
            try {
                await this.saveMessage(
                    userId,
                    options.documentId || null,
                    options.session_id || `error_session_${Date.now()}`,
                    'assistant',
                    "Sorry, I encountered an error while processing your question. Please try again.",
                    {
                        type: 'error',
                        error_message: error.message,
                        failed: true
                    }
                );
            } catch (saveError) {
                logger.error('Failed to save error message:', saveError);
            }

            return this.getErrorResponse(query, error);
        }
    }

    /**
     * Process conversation with history
     */
    async processConversation(messages, userId, options = {}) {
        try {
            logger.info(`Processing conversation for user ${userId} (${messages.length} messages)`);

            const userMessages = messages.filter(m => m.role === 'user');
            const lastUserMessage = userMessages[userMessages.length - 1];

            if (!lastUserMessage) {
                throw new Error('No user message in conversation');
            }

            return await this.processQuery(lastUserMessage.content, userId, options);

        } catch (error) {
            logger.error('Conversation processing failed:', error);
            return this.getErrorResponse('Conversation error', error);
        }
    }

    async getChatHistory(userId, options = {}) {
        try {
            const { documentId, sessionId, limit = 50 } = options;

            logger.info(`Getting chat history for user ${userId}, doc: ${documentId || 'global'}, session: ${sessionId || 'all'}`);

            let query = supabase
                .from('chat_messages')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: true });

            // Filter by document
            if (documentId !== undefined) {
                if (documentId === null || documentId === 'null') {
                    query = query.is('document_id', null); // Global chat
                } else {
                    query = query.eq('document_id', documentId); // Document chat
                }
            }

            // Filter by session
            if (sessionId) {
                query = query.eq('session_id', sessionId);
            }

            // Apply limit
            query = query.limit(parseInt(limit));

            const { data: messages, error } = await query;

            if (error) throw error;

            return {
                success: true,
                data: messages,
                count: messages.length,
                document_id: documentId
            };

        } catch (error) {
            logger.error('Get chat history failed:', error);
            return {
                success: false,
                error: error.message,
                data: []
            };
        }
    }

    async clearChatHistory(userId, options = {}) {
        try {
            const { documentId, sessionId } = options;

            logger.info(`Clearing chat history for user ${userId}, doc: ${documentId || 'all'}, session: ${sessionId || 'all'}`);

            let query = supabase
                .from('chat_messages')
                .delete()
                .eq('user_id', userId);

            // Clear specific document or global
            if (documentId !== undefined) {
                if (documentId === null || documentId === 'null') {
                    query = query.is('document_id', null); // Clear global chat
                } else {
                    query = query.eq('document_id', documentId); // Clear document chat
                }
            }

            // Clear specific session
            if (sessionId) {
                query = query.eq('session_id', sessionId);
            }

            const { error } = await query; // actual deletion is done here


            if (error) throw error;

            return {
                success: true,
                message: documentId ? 'Document chat cleared' : 'Chat history cleared',
                document_id: documentId,
                session_id: sessionId
            };

        } catch (error) {
            logger.error('Clear chat history failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Search documents without generating answer (just retrieval)
     */
    async searchDocuments(query, userId, options = {}) {
        try {
            logger.info(`Searching documents for: "${query.substring(0, 50)}..."`);

            const {
                topK = 10,
                documentId = null,
                minScore = -1.0
            } = options;

            const queryEmbedding = await aiService.generateEmbedding(query);

            const vectorResults = await vectorDB.queryVector(
                queryEmbedding,
                topK,
                documentId ? { document_id: documentId } : null
            );

            logger.info(`Pinecone returned ${vectorResults?.length || 0} results`);
            if (vectorResults && vectorResults.length > 0) {
                logger.info(`First result score: ${vectorResults[0].score}, minScore: ${minScore}`);
            } else {
                logger.warn(`NO RESULTS from Pinecone for query: "${query}"`);
            }

            const filteredResults = vectorResults.filter(r => r.score >= minScore);
            logger.info(`After filter (score >= ${minScore}): ${filteredResults.length} results`);

            const detailedResults = [];
            for (const result of filteredResults) {
                try {
                    const chunk = await supabaseService.getChunkByVectorId(result.id);
                    if (chunk) {
                        detailedResults.push({
                            ...chunk,
                            similarity: result.score,
                            vector_id: result.id
                        });
                    }
                } catch (error) {
                    logger.warn(`Failed to get chunk ${result.id}:`, error.message);
                }
            }

            const resultsByDocument = {};
            detailedResults.forEach(result => {
                if (!resultsByDocument[result.document_id]) {
                    resultsByDocument[result.document_id] = [];
                }
                resultsByDocument[result.document_id].push(result);
            });

            const documents = await Promise.all(
                Object.keys(resultsByDocument).map(async docId => {
                    try {
                        const doc = await supabaseService.getDocument(docId);
                        return {
                            document_id: docId,
                            filename: doc?.filename || 'Unknown',
                            chunks: resultsByDocument[docId]
                        };
                    } catch (error) {
                        return {
                            document_id: docId,
                            filename: 'Unknown',
                            chunks: resultsByDocument[docId]
                        };
                    }
                })
            );

            return {
                success: true,
                query: query,
                results: documents,
                metadata: {
                    total_chunks: detailedResults.length,
                    total_documents: documents.length,
                    min_score: minScore
                }
            };

        } catch (error) {
            logger.error('Document search failed:', error);
            return {
                success: false,
                error: error.message,
                query: query,
                results: []
            };
        }
    }

    /**
     * Get suggested questions based on document content
     */
    async getSuggestedQuestions(documentId, userId, count = 5) {
        try {
            logger.info(`Getting suggested questions for document ${documentId}`);

            const chunks = await supabaseService.getDocumentChunks(documentId);

            if (!chunks || chunks.length === 0) {
                return {
                    success: true,
                    questions: [],
                    message: 'No content available for suggestions'
                };
            }

            const sampleChunks = chunks.slice(0, Math.min(5, chunks.length));
            const sampleText = sampleChunks.map(c => c.content).join('\n\n');

            const prompt = `Based on this text, generate ${count} relevant questions a user might ask:
            
            Text: ${sampleText.substring(0, 2000)}...
            
            Return as JSON array: ["question1", "question2", ...]`;

            const messages = [
                { role: 'system', content: 'Return ONLY valid JSON array of strings.' },
                { role: 'user', content: prompt }
            ];

            const response = await aiService.chatCompletion(messages, 0.2);

            try {
                const questions = JSON.parse(response);
                return {
                    success: true,
                    questions: questions.slice(0, count),
                    document_id: documentId
                };
            } catch (error) {
                logger.warn('Failed to parse suggested questions:', error);
                return {
                    success: true,
                    questions: [
                        "What is this document about?",
                        "Can you summarize the main points?",
                        "What are the key findings?",
                        "Who are the main entities mentioned?"
                    ].slice(0, count)
                };
            }

        } catch (error) {
            logger.error('Get suggested questions failed:', error);
            return {
                success: false,
                error: error.message,
                questions: []
            };
        }
    }

    formatSources(chunks) {
        return chunks.map(chunk => ({
            content_preview: chunk.content.substring(0, 200) + '...',
            document_id: chunk.document_id,
            chunk_id: chunk.id,
            similarity: chunk.similarity,
            metadata: {
                filename: chunk.filename || 'Unknown',
                chunk_index: chunk.chunk_index
            }
        }));
    }

    getNoResultsResponse(query, session_id = null) {
        return {
            success: true,
            query: query,
            answer: "I couldn't find relevant information in your documents to answer this question. Try uploading more documents or asking a different question.",
            session_id: session_id,
            sources: [],
            metadata: {
                chunks_used: 0,
                note: 'No relevant content found'
            }
        };
    }

    getErrorResponse(query, error) {
        return {
            success: false,
            query: query,
            error: error.message || 'Unknown error',
            answer: "Sorry, I encountered an error while processing your question. Please try again.",
            sources: []
        };
    }

    async healthCheck() {
        try {
            const testQuery = "Hello";
            const testEmbedding = await aiService.generateEmbedding(testQuery);

            // ========== NEW: TEST DATABASE CONNECTION ==========
            const { data: dbTest, error: dbError } = await supabase
                .from('chat_messages')
                .select('count', { count: 'exact', head: true });

            return {
                healthy: true,
                embedding_dimension: testEmbedding?.length || 0,
                database_connected: !dbError,
                services: {
                    aiService: true,
                    vectorDB: true,
                    supabaseService: true,
                    chat_messages_table: !dbError
                }
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message
            };
        }
    }
}

module.exports = new ChatService();