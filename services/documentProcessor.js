// services/documentProcessor.js
const logger = require('../utils/logger');
const fileParser = require('../utils/fileParser');
const chunker = require('../utils/chunker');
const aiService = require('./aiService');
const vectorDB = require('./vectorDB');
const supabaseService = require('./supabaseService');
const memoryGraph = require('./memoryGraph');
const constants = require('../config/constants');
const { getIO } = require('../socket/io');
const notificationService = require('./notificationService')

class DocumentProcessor {
    constructor() {
        logger.info('DocumentProcessor initialized');
    }

    /**
     * Emit WebSocket progress
     */
    async emitProgress(userId, documentId, step, progress, message, details = {}) {
        try {
            const io = getIO();
            if (io) {
                const progressData = {
                    documentId,
                    step,
                    progress,
                    message,
                    timestamp: new Date().toISOString(),
                    details
                };

                // Emit to user room
                io.to(`user-${userId}`).emit('document-progress', progressData);

                // Emit to document room if we have documentId
                if (documentId && documentId !== 'null' && documentId !== null && documentId !== 'undefined') {
                    io.to(`document-${documentId}`).emit('document-progress', progressData);
                }

                logger.debug(`Progress emitted: Step ${step}, ${progress}% - ${message}`);
            }
        } catch (error) {
            logger.error('Failed to emit progress:', error);
        }
    }

    /**
     * MAIN PROCESSING PIPELINE WITH WEBSOCKET PROGRESS
     */
    async processDocument(fileBuffer, filename, userId, documentId = null) {
        logger.info(`Starting document processing: ${filename} for user ${userId} with documentId: ${documentId}`);
        const originalFilename = filename;
        let document = null;

        try {
            // STEP 1: Save original file to Supabase Storage (10%)
            logger.info('Step 1: Saving original file to storage...');
            await this.emitProgress(userId, documentId, 1, 10, 'Uploading file to storage...', {
                filename,
                size: fileBuffer.length
            });

            const fileUrl = await supabaseService.uploadFile(fileBuffer, filename, userId);

            //USE EXISTING DOCUMENT OR CREATE NEW
            if (documentId) {
                logger.info(`📝 Using existing document ID: ${documentId}`);

                // Get the existing document
                document = await supabaseService.getDocument(documentId);

                if (!document) {
                    throw new Error(`Document ${documentId} not found`);
                }

                // Update the existing document with file URL
                await supabaseService.updateDocument(documentId, {
                    file_url: fileUrl,
                    file_size: fileBuffer.length,
                    updated_at: new Date().toISOString()
                });

            } else {
                // Create new document if no ID provided
                logger.info('Creating new document record...');
                await this.emitProgress(userId, null, 2, 20, 'Creating document record...');

                document = await supabaseService.createDocument({
                    filename: filename,
                    user_id: userId,
                    file_url: fileUrl,
                    status: constants.STATUS.PROCESSING,
                    file_size: fileBuffer.length
                });

                documentId = document.id; // Set documentId for use later
            }

            //  Use documentId variable (not redefining it)
            // STEP 3: Extract text from file (30%)
            logger.info('Step 3: Extracting text...');
            await this.emitProgress(userId, documentId, 3, 30, 'Extracting text from document...');

            const parseResult = await fileParser.parseFile(fileBuffer, filename);

            if (!parseResult.success) {
                throw new Error(`File parsing failed: ${parseResult.error || 'Unknown error'}`);
            }

            const text = parseResult.text || '';
            const parsingMetadata = parseResult.metadata || {};

            if (!text || text.trim().length < 10) {
                throw new Error('Extracted text is too short or empty');
            }

            await this.emitProgress(userId, documentId, 3, 35, 'Text extraction completed', {
                textLength: text.length
            });

            logger.info(`Text extracted: ${text.length} characters`);

            // Split text into chunks (40%)
            logger.info('Step 4: Splitting into chunks...');
            await this.emitProgress(userId, documentId, 4, 40, 'Splitting text into knowledge chunks...');

            const chunks = chunker.createChunks(
                text,
                constants.CHUNK_SIZE,
                constants.CHUNK_OVERLAP
            );

            logger.info(`Created ${chunks.length} chunks`);

            if (chunks.length === 0) {
                throw new Error('No chunks created from text');
            }

            await this.emitProgress(userId, documentId, 4, 45, 'Chunks created', {
                numChunks: chunks.length
            });

            // STEP 5: Process each chunk with embeddings (50-70%)
            logger.info('Step 5: Processing chunks and generating embeddings...');

            const processedChunks = [];
            const embeddingsBatch = [];
            const chunkMetadatas = [];

            // Prepare batch data for embeddings
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                embeddingsBatch.push(chunk.content);
                chunkMetadatas.push({
                    document_id: documentId, // Use documentId
                    chunk_index: i,
                    content_preview: chunk.content.substring(0, 100),
                    user_id: userId
                });
            }

            // Generate embeddings in batch
            await this.emitProgress(userId, documentId, 5, 50, 'Generating AI embeddings...', {
                current: 0,
                total: chunks.length
            });

            logger.info(`Generating embeddings for ${chunks.length} chunks...`);
            const embeddings = await aiService.generateEmbeddingsBatch(embeddingsBatch);

            // Process each chunk with its embedding
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const embedding = embeddings[i];

                logger.debug(`Processing chunk ${i + 1}/${chunks.length}`);

                // Emit sub-progress for embeddings
                if (i % 5 === 0 || i === chunks.length - 1) {
                    const subProgress = 50 + ((i + 1) / chunks.length) * 20;
                    await this.emitProgress(userId, documentId, 5, Math.min(70, subProgress),
                        'Generating embeddings...', {
                        current: i + 1,
                        total: chunks.length,
                        percentage: Math.round(((i + 1) / chunks.length) * 100)
                    });
                }

                // STEP 5a: Store vector in Pinecone
                const vectorId = await vectorDB.upsertVector(embedding, chunkMetadatas[i]);

                // STEP 5b: Save chunk metadata to Supabase
                const chunkRecord = await supabaseService.createChunk({
                    document_id: documentId, // Use documentId
                    content: chunk.content,
                    chunk_index: i,
                    vector_id: vectorId,
                    start_char: chunk.start,
                    end_char: chunk.end
                });

                processedChunks.push({
                    ...chunkRecord,
                    embedding: embedding,
                    vector_id: vectorId
                });
            }

            await this.emitProgress(userId, documentId, 5, 70, 'Embeddings generated successfully', {
                totalChunks: processedChunks.length
            });

            // STEP 6: Build knowledge graph from chunks (80%)
            logger.info('Step 6: Building knowledge graph...');
            await this.emitProgress(userId, documentId, 6, 80, 'Building knowledge graph...');

            const graphData = await memoryGraph.buildGraphFromChunks(processedChunks, documentId); // ✅ Use documentId

            await this.emitProgress(userId, documentId, 6, 85, 'Knowledge graph built', {
                nodes: graphData.nodes?.length || 0,
                edges: graphData.edges?.length || 0
            });

            // STEP 7: Update document status to completed (90-100%)
            logger.info('Step 7: Updating document status...');
            await this.emitProgress(userId, documentId, 7, 90, 'Finalizing document...');

            await supabaseService.updateDocument(documentId, { // ✅ Use documentId
                status: constants.STATUS.COMPLETED,
                num_chunks: processedChunks.length,
                num_nodes: graphData.nodes?.length || 0,
                num_edges: graphData.edges?.length || 0,
                processed_at: new Date().toISOString(),
                parsing_metadata: parsingMetadata
            });

            // Final completion
            await this.emitProgress(userId, documentId, 7, 100, 'Document processing completed!', {
                summary: {
                    chunks: processedChunks.length,
                    nodes: graphData.nodes?.length || 0,
                    edges: graphData.edges?.length || 0,
                    textLength: text.length
                }
            });
            console.log("📢 DEBUG - filename variable:", filename);
            console.log("📢 DEBUG - userId:", userId);
            console.log("📢 DEBUG - documentId:", documentId);
            // After emitProgress, add:
            await notificationService.documentProcessed(userId, documentId, originalFilename);

            // Emit completion event
            try {
                const io = getIO();
                if (io) {
                    io.to(`user-${userId}`).emit('document-completed', {
                        documentId: documentId, // ✅ Use documentId
                        filename,
                        success: true,
                        timestamp: new Date().toISOString(),
                        result: {
                            num_chunks: processedChunks.length,
                            num_nodes: graphData.nodes?.length || 0,
                            num_edges: graphData.edges?.length || 0
                        }
                    });
                }
            } catch (wsError) {
                logger.error('Failed to emit completion:', wsError);
            }

            logger.info(`🎉 Document processing COMPLETED: ${filename}`);
            logger.info(`📊 Summary: ${processedChunks.length} chunks, ${graphData.nodes?.length || 0} graph nodes, ${graphData.edges?.length || 0} edges`);

            return {
                success: true,
                document_id: documentId, //Use documentId
                filename: filename,
                num_chunks: processedChunks.length,
                num_nodes: graphData.nodes?.length || 0,
                num_edges: graphData.edges?.length || 0,
                file_url: fileUrl,
                text_length: text.length,
                parsing_metadata: parsingMetadata
            };

        } catch (error) {
            logger.error('❌ Document processing FAILED:', error);

            // Emit error via WebSocket
            try {
                const io = getIO();
                if (io && userId && documentId) { // ✅ Use documentId
                    io.to(`user-${userId}`).emit('document-error', {
                        documentId: documentId, // ✅ Use documentId
                        filename,
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (wsError) {
                logger.error('Failed to emit error:', wsError);
            }

            try {
                await notificationService.documentFailed(userId, originalFilename, error.message);
            } catch (notifError) {
                logger.error('Failed to send notification:', notifError);
            }

            // Update document status to failed
            try {
                if (documentId) { // ✅ Use documentId
                    await supabaseService.updateDocument(documentId, {
                        status: constants.STATUS.FAILED,
                        error_message: error.message
                    });
                }
            } catch (updateError) {
                logger.error('Failed to update document status:', updateError);
            }

            throw error;
        }
    }

    /**
     * Process multiple documents with progress tracking
     */
    async processDocuments(fileBuffers, filenames, userId, progressCallback) {
        const results = [];

        for (let i = 0; i < fileBuffers.length; i++) {
            try {
                if (progressCallback) {
                    progressCallback({
                        current: i + 1,
                        total: fileBuffers.length,
                        filename: filenames[i],
                        status: 'processing'
                    });
                }

                const result = await this.processDocument(
                    fileBuffers[i],
                    filenames[i],
                    userId
                );
                results.push(result);

                if (progressCallback) {
                    progressCallback({
                        current: i + 1,
                        total: fileBuffers.length,
                        filename: filenames[i],
                        status: 'completed',
                        result: result
                    });
                }

            } catch (error) {
                logger.error(`Failed to process ${filenames[i]}:`, error);
                results.push({
                    success: false,
                    filename: filenames[i],
                    error: error.message
                });

                if (progressCallback) {
                    progressCallback({
                        current: i + 1,
                        total: fileBuffers.length,
                        filename: filenames[i],
                        status: 'failed',
                        error: error.message
                    });
                }
            }
        }

        return {
            total: results.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results: results
        };
    }

    /**
     * Process documents using new file parser with progress
     */
    async processDocumentsWithParserProgress(fileBuffers, filenames, userId, progressCallback) {
        try {
            logger.info(`Processing ${fileBuffers.length} documents...`);

            // Use the new parseFilesWithProgress method
            const parseResults = await fileParser.parseFilesWithProgress(
                fileBuffers,
                filenames,
                {
                    minTextLength: 10,
                    maxFileSize: 50 * 1024 * 1024 // 50MB
                },
                (parseProgress) => {
                    // Forward progress to our callback
                    if (progressCallback) {
                        progressCallback({
                            ...parseProgress,
                            stage: 'parsing'
                        });
                    }
                }
            );

            // Process only successfully parsed files
            const validResults = parseResults.filter(r => r.success && r.text);
            const validBuffers = [];
            const validFilenames = [];
            const parseData = [];

            for (let i = 0; i < parseResults.length; i++) {
                if (parseResults[i].success && parseResults[i].text) {
                    validBuffers.push(fileBuffers[i]);
                    validFilenames.push(filenames[i]);
                    parseData.push(parseResults[i]);
                }
            }

            logger.info(`Successfully parsed ${validResults.length}/${parseResults.length} files`);

            // Process the valid files
            const processResults = await this.processDocuments(
                validBuffers,
                validFilenames,
                userId,
                (processProgress) => {
                    if (progressCallback) {
                        progressCallback({
                            ...processProgress,
                            stage: 'processing'
                        });
                    }
                }
            );

            // Combine parse and process results
            const combinedResults = [];
            let processIndex = 0;

            for (let i = 0; i < parseResults.length; i++) {
                if (parseResults[i].success && parseResults[i].text) {
                    // This file was successfully processed
                    if (processIndex < processResults.results.length) {
                        combinedResults.push({
                            ...processResults.results[processIndex],
                            parse_metadata: parseData[processIndex]?.metadata
                        });
                        processIndex++;
                    }
                } else {
                    // This file failed parsing
                    combinedResults.push({
                        success: false,
                        filename: filenames[i],
                        error: parseResults[i].error || 'Parsing failed',
                        stage: 'parsing'
                    });
                }
            }

            return {
                total: combinedResults.length,
                successful: combinedResults.filter(r => r.success).length,
                failed: combinedResults.filter(r => !r.success).length,
                results: combinedResults
            };

        } catch (error) {
            logger.error('Batch processing failed:', error);
            throw error;
        }
    }

    /**
     * Get processing status
     */
    async getProcessingStatus(documentId) {
        return await supabaseService.getDocument(documentId);
    }

    /**
     * Delete document and associated data
     */
    async deleteDocument(documentId, userId) {
        logger.info(`Deleting document ${documentId} for user ${userId}`);

        try {
            // Get document info first
            const document = await supabaseService.getDocument(documentId);

            if (!document || document.user_id !== userId) {
                throw new Error('Document not found or access denied');
            }

            // Delete vectors from Pinecone
            const chunks = await supabaseService.getDocumentChunks(documentId);
            for (const chunk of chunks) {
                if (chunk.vector_id) {
                    await vectorDB.deleteVector(chunk.vector_id);
                }
            }

            // Delete from Supabase Storage
            if (document.file_url) {
                await supabaseService.deleteFile(document.filename, userId);
            }

            // Delete graph data
            await memoryGraph.deleteDocumentGraph(documentId);

            // Delete from database
            await supabaseService.deleteDocument(documentId);

            logger.info(` Document ${documentId} deleted successfully`);
            await notificationService.create(
                userId,
                'warning',
                '🗑️ Document Deleted',
                `"${document.filename}" was deleted`,
                documentId
            );

            return { success: true, document_id: documentId };

        } catch (error) {
            logger.error('Failed to delete document:', error);
            throw error;
        }
    }
}

// Export singleton instance
module.exports = new DocumentProcessor();